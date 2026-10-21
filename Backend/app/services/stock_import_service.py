"""
Import stock from a supplier bill  -  the ETL pipeline

    Extract    read the uploaded bill
                 .csv / .xlsx          -> the table itself
                 digital .pdf          -> the text inside the PDF (no OCR needed)
                 photo / scanned PDF   -> OCR service (PaddleOCR, port 8001)
    Transform  turn every bill into the same row format (utils/bill_parser.py)
    Match      find each item in the Jan Aushadhi catalogue (utils/bill_matcher.py)
    Review     the owner checks / fixes the rows on screen        <- nothing saved yet
    Load       confirm_import() adds the reviewed rows as stock batches

preview_import()  never writes to the database.
confirm_import()  re-validates everything and then writes in one step.
"""

import asyncio
import random
import io
import os
import re
import time
from datetime import date, datetime, timezone

import httpx
from fastapi import HTTPException, UploadFile, status

from app.utils.file_checks import verify_upload

from app.core.constants import KENDRAS_COLLECTION, MEDICINES_COLLECTION
from app.database.connection import get_database
from app.schemas.stock_import_schemas import StockImportConfirmRequest
from app.services.kendra_service import (
    ACTIVITIES_COLLECTION,
    EXPIRY_AMBER_DAYS,
    _to_object_id,
    _verify_kendra_ownership,
    compute_stock_status,
    STOCK_WRITE_RETRIES,
    save_stock_if_unchanged,
)
from app.services.notification_service import notify_stock_alert_subscribers
from app.utils.bill_matcher import CatalogueIndex, match_row
from app.utils.bill_parser import (
    extract_invoice_meta,
    group_ocr_lines,
    rows_from_csv_bytes,
    rows_from_table,
    rows_from_text_rows,
    rows_from_xlsx_bytes,
)
from app.utils.logger import logger


STOCK_IMPORTS_COLLECTION = "stock_imports"
OCR_SERVICE_URL = os.getenv("OCR_SERVICE_URL", "http://127.0.0.1:8001").rstrip("/")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 6

IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


# =====================================================
# Catalogue index (built once, reused for a few minutes)
# =====================================================

_INDEX_CACHE: dict = {"at": 0.0, "index": None}
_INDEX_TTL_SECONDS = 300


async def _catalogue_index() -> CatalogueIndex:
    now = time.monotonic()
    if _INDEX_CACHE["index"] is not None and now - _INDEX_CACHE["at"] < _INDEX_TTL_SECONDS:
        return _INDEX_CACHE["index"]
    db = get_database()
    medicines = [
        doc async for doc in db[MEDICINES_COLLECTION].find({"is_active": {"$ne": False}})
    ]
    index = CatalogueIndex(medicines)
    _INDEX_CACHE.update(at=now, index=index)
    return index


# =====================================================
# Extract
# =====================================================

def _file_kind(filename: str, content_type: str) -> str:
    suffix = os.path.splitext(filename or "")[1].lower()
    if suffix in (".csv", ".tsv", ".txt"):
        return "csv"
    if suffix in (".xlsx", ".xlsm"):
        return "xlsx"
    if suffix == ".pdf" or content_type == "application/pdf":
        return "pdf"
    if suffix in IMAGE_TYPES or (content_type or "").startswith("image/"):
        return "image"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Upload a bill as a photo (JPG/PNG), a PDF, an Excel (.xlsx) or a CSV file.",
    )


async def _ocr_lines(data: bytes, filename: str, content_type: str) -> list[dict]:
    """Send an image to the OCR service and get back text boxes."""
    url = f"{OCR_SERVICE_URL}/api/v1/ocr/bill"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(240.0, connect=5.0)) as client:
            response = await client.post(url, files={"file": (filename, data, content_type)})
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "The OCR service is not running on port 8001, so a photo cannot be read. "
                "Start it (cd ocr-service, then: uvicorn app.main:app --host 127.0.0.1 --port 8001) "
                "or upload the bill as a PDF / Excel / CSV file."
            ),
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Reading the bill took too long. Try a smaller or clearer photo.",
        )
    if response.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The OCR service is running but does not have the bill endpoint yet. "
                   "Add ocr-service/app/bill_ocr.py and restart the OCR service.",
        )
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except Exception:
            detail = response.text
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"OCR service: {detail}")
    return response.json().get("lines", [])


def _pdf_text_and_tables(data: bytes) -> tuple[list[str], list[list[list]], list[bytes]]:
    """
    -> (text lines of all pages, tables found, page images when the PDF has no text)
    """
    try:
        import pdfplumber
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PDF import needs the 'pdfplumber' package: pip install pdfplumber",
        ) from exc

    lines: list[str] = []
    tables: list[list[list]] = []
    images: list[bytes] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = pdf.pages[:MAX_PDF_PAGES]
            for page in pages:
                text = page.extract_text() or ""
                lines.extend(line for line in text.splitlines() if line.strip())
                try:
                    tables.extend(page.extract_tables() or [])
                except Exception:
                    pass
            if not "".join(lines).strip():
                for page in pages:
                    buffer = io.BytesIO()
                    page.to_image(resolution=170).original.convert("RGB").save(buffer, format="PNG")
                    images.append(buffer.getvalue())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This PDF could not be opened ({exc.__class__.__name__}).",
        ) from exc
    return lines, tables, images


async def _extract(kind: str, data: bytes, filename: str, content_type: str) -> dict:
    """-> {"rows", "unparsed", "header_found", "meta_lines", "ocr_used"}"""
    if kind == "csv":
        rows, unparsed, found = rows_from_csv_bytes(data)
        return {"rows": rows, "unparsed": unparsed, "header_found": found, "meta_lines": [], "ocr_used": False}

    if kind == "xlsx":
        try:
            rows, unparsed, found = await asyncio.to_thread(rows_from_xlsx_bytes, data)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"This Excel file could not be read ({exc.__class__.__name__}).")
        return {"rows": rows, "unparsed": unparsed, "header_found": found, "meta_lines": [], "ocr_used": False}

    if kind == "pdf":
        lines, tables, images = await asyncio.to_thread(_pdf_text_and_tables, data)
        if lines:
            rows, unparsed, found = rows_from_text_rows(lines)
            if not rows:                                   # ruled tables read better as cells
                for table in tables:
                    rows, unparsed, found = rows_from_table(table)
                    if rows:
                        break
            return {"rows": rows, "unparsed": unparsed, "header_found": found, "meta_lines": lines, "ocr_used": False}
        # scanned PDF: OCR every page image
        text_rows: list[str] = []
        for number, image in enumerate(images, start=1):
            ocr = await _ocr_lines(image, f"page{number}.png", "image/png")
            text_rows.extend(group_ocr_lines(ocr))
        rows, unparsed, found = rows_from_text_rows(text_rows)
        return {"rows": rows, "unparsed": unparsed, "header_found": found, "meta_lines": text_rows, "ocr_used": True}

    # photo
    ocr = await _ocr_lines(data, filename or "bill.jpg", content_type or "image/jpeg")
    text_rows = group_ocr_lines(ocr)
    rows, unparsed, found = rows_from_text_rows(text_rows)
    return {"rows": rows, "unparsed": unparsed, "header_found": found, "meta_lines": text_rows, "ocr_used": True}


# =====================================================
# Validation (shared by preview + confirm)
# =====================================================

def _today() -> date:
    return datetime.now(timezone.utc).date()


def row_issues(expiry, quantity, batch, pmbi_code) -> tuple[list[str], list[str]]:
    """-> (blocking errors, warnings)"""
    errors, warnings = [], []
    if not pmbi_code:
        errors.append("Choose the matching catalogue medicine.")
    if not batch:
        errors.append("Batch number is missing.")
    if expiry is None:
        errors.append("Expiry date is missing.")
    else:
        days = (expiry - _today()).days
        if days < 0:
            errors.append("Expiry date is in the past - expired stock cannot be added.")
        elif days <= EXPIRY_AMBER_DAYS:
            warnings.append(f"Expires in {days} days.")
    if not quantity or quantity <= 0:
        errors.append("Quantity must be at least 1.")
    return errors, warnings


def _norm_invoice(value) -> str:
    return re.sub(r"\s+", "", value or "").upper()


async def _find_duplicate(kendra_id: str, invoice_no, supplier):
    if not invoice_no:
        return None
    db = get_database()
    query = {"kendra_id": kendra_id, "invoice_no_norm": _norm_invoice(invoice_no)}
    if supplier:
        query["supplier_norm"] = _norm_invoice(supplier)
    found = await db[STOCK_IMPORTS_COLLECTION].find_one(query)
    if not found:
        return None
    at = found.get("imported_at")
    return {
        "invoice_no": found.get("invoice_no"),
        "supplier_name": found.get("supplier_name"),
        "imported_at": at.isoformat() if hasattr(at, "isoformat") else None,
        "rows_count": found.get("rows_count"),
    }


# =====================================================
# Preview  (read + match, writes nothing)
# =====================================================

async def preview_import(kendra_id: str, upload: UploadFile, current_user) -> dict:
    _to_object_id(kendra_id)
    await _verify_kendra_ownership(kendra_id, current_user)

    data = await upload.read(MAX_UPLOAD_BYTES + 1)  # never load more than the limit + 1 byte
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="The file must be smaller than 10 MB.")

    filename = upload.filename or "bill"
    content_type = upload.content_type or ""
    kind = _file_kind(filename, content_type)
    verify_upload(kind, data)  # check the real file content, not just its name

    started = time.perf_counter()
    extracted = await _extract(kind, data, filename, content_type)
    index = await _catalogue_index()

    rows_out = []
    counts = {"ready": 0, "review": 0, "unmatched": 0}
    for row in extracted["rows"]:
        match = match_row(row, index)
        best = match["best"]
        expiry = date.fromisoformat(row["expiry_date"]) if row.get("expiry_date") else None
        errors, warnings = row_issues(
            expiry, row.get("quantity"), row.get("batch_number"), best["pmbi_code"] if best else None
        )
        # parser warnings that repeat a blocking error add nothing
        parser_warnings = [
            w for w in row.get("warnings", [])
            if not any(w.split(" ")[0].lower() == e.split(" ")[0].lower() for e in errors)
        ]
        warnings = parser_warnings + warnings

        level = match["level"]
        if level == "review":
            warnings.append("Please confirm the medicine - the match is not certain.")
        if level == "high" and not errors:
            counts["ready"] += 1
        elif level == "none":
            counts["unmatched"] += 1
        else:
            counts["review"] += 1

        rows_out.append({
            "line_no": row["line_no"],
            "item_name": row["item_name"],
            "batch_number": row.get("batch_number"),
            "expiry_date": row.get("expiry_date"),
            "quantity": row.get("quantity"),
            "free_qty": row.get("free_qty", 0),
            "pack_size": row.get("pack_size"),
            "mrp": row.get("mrp"),
            "purchase_rate": row.get("purchase_rate"),
            "manufacturer": row.get("manufacturer"),
            "amount": row.get("amount"),
            "match_level": level,
            "pmbi_code": best["pmbi_code"] if best else None,
            "match": best,
            "candidates": match["candidates"],
            "errors": errors,
            "warnings": warnings,
            "include": not errors and level != "none",
        })

    meta = extract_invoice_meta(extracted["meta_lines"]) if extracted["meta_lines"] else {
        "invoice_no": None, "invoice_date": None, "supplier_name": None, "supplier_gstin": None,
    }
    duplicate = await _find_duplicate(kendra_id, meta["invoice_no"], None)

    logger.info(f"Stock import preview kendra={kendra_id} kind={kind} rows={len(rows_out)} "
                f"in {time.perf_counter() - started:.1f}s")

    return {
        "source": kind,
        "file_name": filename,
        "ocr_used": extracted["ocr_used"],
        "header_found": extracted["header_found"],
        "invoice": meta,
        "duplicate_of": duplicate,
        "rows": rows_out,
        "unparsed_lines": extracted["unparsed"][:30],
        "summary": {"rows": len(rows_out), **counts},
        "seconds": round(time.perf_counter() - started, 1),
    }


# =====================================================
# Confirm  (the Load step)
# =====================================================

def _batch_key(batch) -> str:
    return re.sub(r"\s+", "", batch or "").upper()


def _batch_expiry_date(batch: dict):
    value = batch.get("expiry_date")
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


async def confirm_import(kendra_id: str, data: StockImportConfirmRequest, current_user) -> dict:
    db = get_database()
    object_id = _to_object_id(kendra_id)
    await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(status_code=404, detail="Kendra not found.")

    # ---- the same bill must not be loaded twice
    if data.invoice_no and not data.allow_duplicate:
        duplicate = await _find_duplicate(kendra_id, data.invoice_no, data.supplier_name)
        if duplicate:
            when = (duplicate["imported_at"] or "")[:10]
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"Invoice {duplicate['invoice_no']} was already imported"
                        f"{' on ' + when if when else ''}. Tick 'Import again anyway' only if this "
                        f"really is a second delivery."),
            )

    # ---- re-validate every row against the catalogue (the browser is not trusted)
    codes = sorted({row.pmbi_code for row in data.rows})
    catalogue = {
        doc["pmbi_code"]: doc
        async for doc in db[MEDICINES_COLLECTION].find({"pmbi_code": {"$in": codes}})
    }
    problems = []
    for number, row in enumerate(data.rows, start=1):
        if row.pmbi_code not in catalogue:
            problems.append(f"Row {number}: medicine code {row.pmbi_code} is not in the catalogue.")
        errors, _ = row_issues(row.expiry_date, row.quantity, row.batch_number, row.pmbi_code)
        problems.extend(f"Row {number}: {error}" for error in errors)
    if problems:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nothing was imported. Please fix: " + " | ".join(problems[:8]),
        )

    # ---- merge into the stock array
    for _attempt in range(STOCK_WRITE_RETRIES):
        if _attempt:
            await asyncio.sleep(random.uniform(0, 0.03 * _attempt))  # tiny random pause so retries do not collide again
            # another request changed this Kendra's stock meanwhile: reload and redo the calculation
            kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
            if not kendra:
                raise HTTPException(status_code=404, detail="Kendra not found.")
        stock = kendra.get("stock", [])
        previous_qty = {item["pmbi_code"]: item["total_qty"] for item in stock}
        imported_at = datetime.now(timezone.utc)
        supplier_default = (data.supplier_name or "").strip()
        new_batches = merged = units = 0

        for row in data.rows:
            manufacturer = (row.manufacturer or supplier_default or "").strip()
            if len(manufacturer) < 2:
                manufacturer = "Not stated"
            expiry_dt = datetime(row.expiry_date.year, row.expiry_date.month, row.expiry_date.day)

            item = next((s for s in stock if s["pmbi_code"] == row.pmbi_code), None)
            if item is None:
                item = {"pmbi_code": row.pmbi_code, "total_qty": 0, "status": "out_of_stock", "batches": []}
                stock.append(item)

            existing = next(
                (b for b in item["batches"]
                 if _batch_key(b.get("batch_number")) == _batch_key(row.batch_number)
                 and _batch_expiry_date(b) == row.expiry_date),
                None,
            )
            if existing:
                existing["quantity"] = int(existing.get("quantity", 0)) + row.quantity
                if row.selling_price is not None:
                    existing["selling_price"] = row.selling_price
                merged += 1
            else:
                batch = {
                    "batch_number": row.batch_number,
                    "expiry_date": expiry_dt,
                    "quantity": row.quantity,
                    "manufacturer": manufacturer,
                    "verification_status": data.verification_status,
                }
                if row.selling_price is not None:
                    batch["selling_price"] = row.selling_price
                if row.purchase_rate is not None:
                    batch["purchase_rate"] = row.purchase_rate
                if row.mrp is not None:
                    batch["mrp_on_bill"] = row.mrp
                if data.invoice_no:
                    batch["supplier_invoice_no"] = data.invoice_no
                item["batches"].append(batch)
                new_batches += 1

            item["total_qty"] = sum(int(b.get("quantity", 0)) for b in item["batches"])
            item["status"] = compute_stock_status(item["total_qty"])
            units += row.quantity

        if await save_stock_if_unchanged(db, object_id, stock, kendra.get("stock_version")):
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The stock was being changed by someone else. Nothing was saved - please try again.",
        )

    # ---- audit trail + the import record (also what blocks a second import)
    user_email = getattr(current_user, "sub", None)
    for row in data.rows:
        await db[ACTIVITIES_COLLECTION].insert_one({
            "kendra_id": str(object_id),
            "type": "restock",
            "pmbi_code": row.pmbi_code,
            "quantity": row.quantity,
            "batch_number": row.batch_number,
            "by": user_email,
            "at": imported_at,
            "source": "bill_import",
            "invoice_no": data.invoice_no,
        })

    record = await db[STOCK_IMPORTS_COLLECTION].insert_one({
        "kendra_id": str(object_id),
        "invoice_no": data.invoice_no,
        "invoice_no_norm": _norm_invoice(data.invoice_no),
        "supplier_name": data.supplier_name,
        "supplier_norm": _norm_invoice(data.supplier_name),
        "invoice_date": data.invoice_date.isoformat() if data.invoice_date else None,
        "source": data.source,
        "file_name": data.file_name,
        "verification_status": data.verification_status,
        "rows": [row.model_dump(mode="json") for row in data.rows],
        "rows_count": len(data.rows),
        "units_added": units,
        "imported_by": user_email,
        "imported_at": imported_at,
    })

    # ---- "Notify me" subscribers for medicines that were out of stock
    for code in codes:
        now_qty = next((s["total_qty"] for s in stock if s["pmbi_code"] == code), 0)
        if previous_qty.get(code, 0) <= 0 < now_qty:
            medicine = catalogue.get(code, {})
            try:
                await notify_stock_alert_subscribers(
                    pmbi_code=code,
                    medicine_name=medicine.get("brand_name") or code,
                    kendra_name=kendra["name"],
                )
            except Exception as exc:  # notifications must never undo a stock import
                logger.warning(f"Stock alert for {code} failed: {exc}")

    logger.info(f"Stock import kendra={kendra_id} rows={len(data.rows)} units={units}")

    return {
        "message": "Stock added from the supplier bill.",
        "import_id": str(record.inserted_id),
        "rows_imported": len(data.rows),
        "medicines": len(codes),
        "units_added": units,
        "new_batches": new_batches,
        "merged_into_existing_batches": merged,
    }