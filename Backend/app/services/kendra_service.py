import asyncio
import random
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app.database.connection import get_database
from app.core.constants import KENDRAS_COLLECTION, MEDICINES_COLLECTION, BILLS_COLLECTION
from app.schemas.kendra_schemas import RestockRequest, BillRequest, BillingDetailsRequest
from app.utils.geo import haversine_km
from app.utils.logger import logger
from app.services.notification_service import notify_stock_alert_subscribers

DEFAULT_RADIUS_KM = 5.0

ACTIVITIES_COLLECTION = "inventory_activities"
BILL_COUNTERS_COLLECTION = "bill_counters"
MFR_CODE = "PMB"  # shown in the "Mfr." column for PMBI (Jan Aushadhi) products
EXPIRY_AMBER_DAYS = 60
EXPIRY_RED_DAYS = 30
IST = timezone(timedelta(hours=5, minutes=30))


async def _verify_kendra_ownership(kendra_id: str, current_user) -> None:
    """
    ADMIN can manage any Kendra. PHARMACY users can only manage the
    single Kendra they're assigned to (assigned_kendra_id on their
    user document). Looked up fresh from the DB rather than trusting
    the JWT, since the token doesn't carry assigned_kendra_id.
    """
    if current_user.role == "ADMIN":
        return

    db = get_database()
    user = await db.users.find_one({"email": current_user.sub})
    if not user or user.get("assigned_kendra_id") != kendra_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not manage this Kendra.",
        )


def _to_object_id(kendra_id: str) -> ObjectId:
    try:
        return ObjectId(kendra_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid kendra id."
        )


def _serialize_kendra(doc: dict, distance_km: float | None = None) -> dict:
    coords = doc["location"]["coordinates"]  # [lng, lat]
    return {
        "id": str(doc["_id"]),
        "name": doc["name"],
        "address": doc["address"],
        "phone": doc.get("phone"),
        "rating": doc.get("rating"),
        "longitude": coords[0],
        "latitude": coords[1],
        "distance_km": distance_km,
        "stock": doc.get("stock", []),
    }


async def find_nearby_kendras(
    lat: float,
    lng: float,
    radius_km: float = DEFAULT_RADIUS_KM,
) -> dict:
    """
    Find active Kendras within radius_km of the given point.
    Distance computed in Python (haversine) rather than relying on a
    Mongo geospatial index, so this works the same in any environment.
    """
    db = get_database()

    cursor = db[KENDRAS_COLLECTION].find({"is_active": {"$ne": False}})

    results = []
    async for doc in cursor:
        coords = doc["location"]["coordinates"]
        dist = haversine_km(lat, lng, coords[1], coords[0])
        if dist <= radius_km:
            results.append(_serialize_kendra(doc, distance_km=dist))

    results.sort(key=lambda k: k["distance_km"])

    return {"total": len(results), "results": results}


async def get_kendra_by_id(kendra_id: str) -> dict:
    db = get_database()
    object_id = _to_object_id(kendra_id)

    doc = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    return _serialize_kendra(doc)


TRUST_SCORES = {"verified": 1.0, "distributor": 0.7, "unverified": 0.4}


async def find_medicine_availability(
    pmbi_code: str,
    lat: float,
    lng: float,
    radius_km: float = DEFAULT_RADIUS_KM,
    only_in_stock: bool = True,
    weights: dict | None = None,
) -> list:
    """
    Find nearby Kendras stocking a specific medicine and rank them
    with the Weighted Sum Model (WSM).
    """
    weights = weights or {
        "distance": 0.40,
        "price": 0.25,
        "quantity": 0.25,
        "freshness": 0.10,
        "trust": 0.0,  # all stock is verified, so this factor is not used
    }

    if abs(sum(weights.values()) - 1.0) > 0.001:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ranking weights must add up to 1.0.",
        )

    db = get_database()

    medicine = await db[MEDICINES_COLLECTION].find_one(
        {"pmbi_code": pmbi_code}
    )
    default_price = (
        float(medicine["jan_aushadhi_mrp"]) if medicine else 0.0
    )

    cursor = db[KENDRAS_COLLECTION].find(
        {
            "is_active": {"$ne": False},
            "stock.pmbi_code": pmbi_code,
        }
    )

    now = datetime.now(timezone.utc)
    candidates = []

    async for doc in cursor:
        coords = doc["location"]["coordinates"]

        distance = haversine_km(lat, lng, coords[1], coords[0])

        if distance > radius_km:
            continue

        stock_item = next(
            (
                item
                for item in doc.get("stock", [])
                if item["pmbi_code"] == pmbi_code
            ),
            None,
        )

        if not stock_item:
            continue

        total_qty = stock_item.get("total_qty", 0)

        if only_in_stock and total_qty <= 0:
            continue

        batches = sorted(
            [
                b
                for b in stock_item.get("batches", [])
                if b.get("quantity", 0) > 0
            ],
            key=lambda b: b["expiry_date"],
        )
        first = batches[0] if batches else None

        expiry = first["expiry_date"] if first else None
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        days_to_expiry = max((expiry - now).days, 0) if expiry else 0

        candidates.append(
            {
                "doc": doc,
                "coords": coords,
                "distance": distance,
                "total_qty": total_qty,
                "stock_item": stock_item,
                "batches": batches,
                "expiry": expiry,
                "days": days_to_expiry,
                "price": (
                    float(first.get("selling_price") or default_price)
                    if first
                    else default_price
                ),
                "verification": (first or {}).get(
                    "verification_status", "unverified"
                ),
            }
        )

    if not candidates:
        return []

    max_dist = max(c["distance"] for c in candidates) or 1.0
    max_price = max(c["price"] for c in candidates) or 1.0

    results = []

    for c in candidates:
        scores = {
            "distance": 1 - c["distance"] / max_dist,
            "price": 1 - c["price"] / max_price,
            "quantity": min(c["total_qty"] / 50, 1),
            "freshness": min(c["days"] / 365, 1),
            "trust": TRUST_SCORES.get(c["verification"], 0.4),
        }
        wsm = sum(weights[k] * scores[k] for k in weights)
        doc = c["doc"]

        results.append(
            {
                "kendra_id": str(doc["_id"]),
                "kendra_name": doc["name"],
                "address": doc["address"],
                "phone": doc.get("phone"),
                "latitude": c["coords"][1],
                "longitude": c["coords"][0],
                "distance_km": round(c["distance"], 2),
                "price": round(c["price"], 2),
                "total_qty": c["total_qty"],
                "status": c["stock_item"].get("status", "out_of_stock"),
                "nearest_expiry": c["expiry"],
                "days_to_expiry": c["days"],
                "verification_status": c["verification"],
                "wsm_score": round(wsm, 4),
                "score_breakdown": {
                    "distance_score": round(scores["distance"], 4),
                    "price_score": round(scores["price"], 4),
                    "quantity_score": round(scores["quantity"], 4),
                    "freshness_score": round(scores["freshness"], 4),
                    "trust_score": round(scores["trust"], 4),
                },
                "weights_used": weights,
                "batches": [
                    {
                        "batch_number": b["batch_number"],
                        "manufacturer": b["manufacturer"],
                        "expiry_date": b["expiry_date"],
                        "quantity": b["quantity"],
                        "selling_price": b.get("selling_price"),
                        "verification_status": b.get(
                            "verification_status", "unverified"
                        ),
                    }
                    for b in c["batches"]
                ],
            }
        )

    results.sort(key=lambda r: r["wsm_score"], reverse=True)

    for rank, r in enumerate(results, start=1):
        r["rank"] = rank

    return results


STOCK_WRITE_RETRIES = 8


async def save_stock_if_unchanged(db, object_id, stock: list, loaded_version) -> bool:
    """
    Save the stock array only if nobody else changed it since we read it
    (optimistic locking via a `stock_version` counter on the Kendra document).
    Returns False when another request got there first - the caller reloads and retries.
    This is what stops two simultaneous bills from overselling or overwriting each other.
    """
    version_filter = loaded_version if loaded_version is not None else {"$exists": False}
    result = await db[KENDRAS_COLLECTION].update_one(
        {"_id": object_id, "stock_version": version_filter},
        {"$set": {"stock": stock}, "$inc": {"stock_version": 1}},
    )
    return result.matched_count == 1


def compute_stock_status(quantity: int) -> str:
    """SRS-defined stock status transitions."""
    if quantity <= 0:
        return "out_of_stock"
    if quantity <= 5:
        return "low_stock"
    return "in_stock"


async def restock_medicine(kendra_id: str, data: RestockRequest, current_user=None) -> dict:
    """
    Add a new batch of stock arriving from the supplier (Pharmacy Owner).
    This is separate from billing — it only ever ADDS stock.
    """
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    for _attempt in range(STOCK_WRITE_RETRIES):
        if _attempt:
            await asyncio.sleep(random.uniform(0, 0.03 * _attempt))  # tiny random pause so retries do not collide again
            # another request changed this Kendra's stock meanwhile: reload and redo the calculation
            kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
            if not kendra:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kendra not found.")
        stock = kendra.get("stock", [])
        new_batch = {
            "batch_number": data.batch_number,
            "expiry_date": data.expiry_date,
            "quantity": data.quantity,
            "manufacturer": data.manufacturer,
            "verification_status": data.verification_status,
        }
        if data.selling_price is not None:
            new_batch["selling_price"] = data.selling_price

        stock_item = next((s for s in stock if s["pmbi_code"] == data.pmbi_code), None)
        previous_qty = stock_item["total_qty"] if stock_item else 0

        if stock_item is None:
            # First time this medicine is stocked at this Kendra
            stock.append({
                "pmbi_code": data.pmbi_code,
                "total_qty": data.quantity,
                "status": compute_stock_status(data.quantity),
                "batches": [new_batch],
            })
            new_qty = data.quantity
        else:
            stock_item["batches"].append(new_batch)
            stock_item["total_qty"] = sum(b["quantity"] for b in stock_item["batches"])
            stock_item["status"] = compute_stock_status(stock_item["total_qty"])
            new_qty = stock_item["total_qty"]

        if await save_stock_if_unchanged(db, object_id, stock, kendra.get("stock_version")):
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The stock was being changed by someone else. Nothing was saved - please try again.",
        )

    # SRS "Customer Stock Alert": if this medicine was out of stock and
    # is now available, notify anyone who subscribed via "Notify Me".
    if previous_qty <= 0 < new_qty:
        medicine = await db[MEDICINES_COLLECTION].find_one({"pmbi_code": data.pmbi_code})
        medicine_name = medicine["brand_name"] if medicine else data.pmbi_code
        await notify_stock_alert_subscribers(
            pmbi_code=data.pmbi_code,
            medicine_name=medicine_name,
            kendra_name=kendra["name"],
        )

    await db[ACTIVITIES_COLLECTION].insert_one({
        "kendra_id": str(object_id),
        "type": "restock",
        "pmbi_code": data.pmbi_code,
        "quantity": data.quantity,
        "batch_number": data.batch_number,
        "by": getattr(current_user, "sub", None),
        "at": datetime.now(timezone.utc),
    })

    logger.info(f"Restocked {data.pmbi_code} at kendra {kendra_id}: +{data.quantity}")

    return {
        "message": "Stock added successfully.",
        "pmbi_code": data.pmbi_code,
        "batch_number": data.batch_number,
    }


def _as_utc(value):
    """Mongo returns naive UTC datetimes; make them timezone-aware."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _deduct_fifo(batches: list, quantity_needed: int) -> tuple[list, list]:
    """
    Deduct quantity_needed from batches, oldest-expiry-first.
    Expired batches are never sold: they stay in stock untouched so the
    owner can see and remove them (Inventory Dashboard -> Expired).
    Returns (remaining_batches, deduction_log).
    Raises HTTPException if sellable (non-expired) stock is insufficient.
    """
    now = datetime.now(timezone.utc)
    expired = [b for b in batches if _as_utc(b["expiry_date"]) <= now]
    sellable = [b for b in batches if _as_utc(b["expiry_date"]) > now]

    available = sum(b["quantity"] for b in sellable)
    if available < quantity_needed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Insufficient stock. Requested {quantity_needed}, "
                f"available {available} (expired batches cannot be sold)."
            ),
        )

    sorted_batches = sorted(sellable, key=lambda b: _as_utc(b["expiry_date"]))
    remaining_to_deduct = quantity_needed
    deduction_log = []
    result_batches = []

    for batch in sorted_batches:
        if remaining_to_deduct <= 0:
            result_batches.append(batch)
            continue

        take = min(batch["quantity"], remaining_to_deduct)
        remaining_to_deduct -= take

        deduction_log.append({
            "batch_number": batch["batch_number"],
            "expiry_date": batch["expiry_date"],
            "quantity_deducted": take,
        })

        new_qty = batch["quantity"] - take
        if new_qty > 0:
            result_batches.append({**batch, "quantity": new_qty})
        # else: batch fully consumed, dropped from result_batches

    return result_batches + expired, deduction_log


CENT = Decimal("0.01")


def _d(value) -> Decimal:
    return Decimal(str(value))


def _money(value) -> float:
    """Round to paise, halves upward (what a printed invoice does)."""
    return float(_d(value).quantize(CENT, rounding=ROUND_HALF_UP))


def compute_invoice_totals(subtotal, discount, gst_percentage) -> dict:
    """
    Indian MRP-inclusive invoice maths.

    MRP already contains GST, so tax is taken OUT of the amount, not added:
        net      = MRP total - discount
        taxable  = net / (1 + rate)
        GST      = net - taxable   (split equally into CGST and SGST)
        bill     = net rounded to the nearest rupee; round_off is the difference
    """
    net = _d(subtotal) - _d(discount)
    rate = _d(gst_percentage)

    taxable = (net * 100 / (100 + rate)).quantize(CENT, rounding=ROUND_HALF_UP)
    gst = net - taxable
    cgst = (gst / 2).quantize(CENT, rounding=ROUND_HALF_UP)
    sgst = gst - cgst
    total = net.quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    return {
        "taxable_value": float(taxable),
        "cgst": float(cgst),
        "sgst": float(sgst),
        "gst_amount": float(gst),
        "round_off": float(total - net),
        "total_amount": float(total),
    }


async def _next_bill_number(db, kendra_id: str) -> str:
    """Sequential per-Kendra bill number (1, 2, 3 ...), like a bill book."""
    counter = await db[BILL_COUNTERS_COLLECTION].find_one_and_update(
        {"_id": kendra_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return str(counter["seq"])


async def generate_bill(kendra_id: str, data: BillRequest, current_user=None) -> dict:
    """
    Generate a GST invoice for one or more medicines sold.
    For each line item: deducts stock FIFO (oldest non-expired batch first),
    recomputes total_qty + status, then saves the bill with a sequential
    bill number and a snapshot of the shop details.
    """
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    for _attempt in range(STOCK_WRITE_RETRIES):
        if _attempt:
            await asyncio.sleep(random.uniform(0, 0.03 * _attempt))  # tiny random pause so retries do not collide again
            # another request changed this Kendra's stock meanwhile: reload and redo the calculation
            kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
            if not kendra:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kendra not found.")
        stock = kendra.get("stock", [])
        line_items = []
        subtotal = Decimal("0")

        for item in data.items:
            stock_item = next((s for s in stock if s["pmbi_code"] == item.pmbi_code), None)
            if stock_item is None or not stock_item.get("batches"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Medicine '{item.pmbi_code}' is not stocked at this Kendra.",
                )

            medicine = await db[MEDICINES_COLLECTION].find_one({"pmbi_code": item.pmbi_code})
            if not medicine:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Medicine '{item.pmbi_code}' not found in catalog.",
                )

            remaining_batches, deduction_log = _deduct_fifo(stock_item["batches"], item.quantity)

            stock_item["batches"] = remaining_batches
            stock_item["total_qty"] = sum(b["quantity"] for b in remaining_batches)
            stock_item["status"] = compute_stock_status(stock_item["total_qty"])

            unit_price = _d(medicine["jan_aushadhi_mrp"])
            line_total = (unit_price * item.quantity).quantize(CENT, rounding=ROUND_HALF_UP)
            subtotal += line_total

            line_items.append({
                "pmbi_code": item.pmbi_code,
                "medicine_name": medicine["brand_name"],
                "item_name": medicine.get("generic_name") or medicine["brand_name"],
                "pack_size": medicine.get("pack_size"),
                "quantity": item.quantity,
                "unit_price": float(unit_price),
                "line_total": float(line_total),
                "batches_used": deduction_log,
            })

        discount = _d(data.discount).quantize(CENT, rounding=ROUND_HALF_UP)
        if discount > subtotal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Discount (₹{discount}) cannot exceed the bill total (₹{subtotal}).",
            )
        totals = compute_invoice_totals(subtotal, discount, data.gst_percentage)

        # Persist updated stock (FIFO deduction applied)
        if await save_stock_if_unchanged(db, object_id, stock, kendra.get("stock_version")):
            break
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The stock was being changed by someone else. Nothing was saved - please try again.",
        )

    billed_at = datetime.now(timezone.utc)
    bill_number = await _next_bill_number(db, str(object_id))

    billed_by_email = getattr(current_user, "sub", None)
    billed_by_name = None
    if billed_by_email:
        user = await db.users.find_one({"email": billed_by_email})
        billed_by_name = (user or {}).get("full_name")

    bill_doc = {
        "kendra_id": str(object_id),
        "kendra": {
            "name": kendra.get("name"),
            "address": kendra.get("address"),
            "phone": kendra.get("phone"),
            "gstin": kendra.get("gstin"),
            "drug_license_no": kendra.get("drug_license_no"),
        },
        "bill_number": bill_number,
        "customer_name": (data.customer_name or "").strip() or None,
        "customer_phone": (data.customer_phone or "").strip() or None,
        "doctor_name": (data.doctor_name or "").strip() or None,
        "items": line_items,
        "subtotal": float(subtotal),
        "discount": float(discount),
        "gst_percentage": data.gst_percentage,
        "gst_inclusive": True,
        **totals,
        "payment_method": data.payment_method,
        "billed_by": billed_by_email,
        "billed_by_name": billed_by_name,
        "billed_at": billed_at,
    }
    result = await db[BILLS_COLLECTION].insert_one(bill_doc)

    logger.info(f"Bill {bill_number} generated at kendra {kendra_id}: total ₹{totals['total_amount']}")

    return _serialize_bill({**bill_doc, "_id": result.inserted_id})


# ─────────────────────────────────────────────────────────────────────────────
# Bills: serialisation, history, single bill
# ─────────────────────────────────────────────────────────────────────────────

def _serialize_bill(doc: dict) -> dict:
    """Uniform bill shape. Bills saved before the GST invoice upgrade are
    filled with sensible defaults so the history page never breaks."""
    total = doc.get("total_amount", 0.0)
    subtotal = doc.get("subtotal", total)
    discount = doc.get("discount", 0.0)
    gst_amount = doc.get("gst_amount", 0.0)

    legacy = not doc.get("gst_inclusive")
    if legacy:
        # Old bills added GST on top of the amount; keep their numbers as saved.
        taxable = _money(_d(subtotal) - _d(discount))
        cgst = _money(_d(gst_amount) / 2)
        sgst = _money(_d(gst_amount) - _d(cgst))
        round_off = 0.0
    else:
        taxable = doc.get("taxable_value", 0.0)
        cgst = doc.get("cgst", 0.0)
        sgst = doc.get("sgst", 0.0)
        round_off = doc.get("round_off", 0.0)

    items = []
    for it in doc.get("items", []):
        items.append({
            **it,
            "item_name": it.get("item_name") or it.get("medicine_name"),
            "pack_size": it.get("pack_size"),
        })

    return {
        "bill_id": str(doc["_id"]),
        "bill_number": doc.get("bill_number") or f"JA-{str(doc['_id'])[-8:].upper()}",
        "kendra_id": doc["kendra_id"],
        "kendra": doc.get("kendra") or {},
        "customer_name": doc.get("customer_name"),
        "customer_phone": doc.get("customer_phone"),
        "doctor_name": doc.get("doctor_name"),
        "items": items,
        "subtotal": subtotal,
        "discount": discount,
        "taxable_value": taxable,
        "gst_percentage": doc.get("gst_percentage", 0.0),
        "cgst": cgst,
        "sgst": sgst,
        "gst_amount": gst_amount,
        "round_off": round_off,
        "total_amount": total,
        "payment_method": doc.get("payment_method", "cash"),
        "billed_by_name": doc.get("billed_by_name"),
        "billed_at": doc["billed_at"],
    }


def _ist_day_start_utc(day: datetime) -> datetime:
    """Midnight (India time) of the day containing `day`, as UTC."""
    local = day.astimezone(IST)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc)


def _parse_date_ist(value: str | None, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        day = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=IST)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dates must be in YYYY-MM-DD format.",
        )
    if end_of_day:
        day = day + timedelta(days=1)
    return day.astimezone(timezone.utc)


async def list_bills(
    kendra_id: str,
    current_user=None,
    page: int = 1,
    page_size: int = 10,
    search: str | None = None,
    payment_method: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    """Paginated bill history for one Kendra, newest first, with filters.
    `summary` covers every bill matching the filters, not just this page."""
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    query: dict = {"kendra_id": str(object_id)}

    if search and search.strip():
        pattern = re.escape(search.strip())
        query["$or"] = [
            {"bill_number": {"$regex": pattern, "$options": "i"}},
            {"customer_name": {"$regex": pattern, "$options": "i"}},
            {"customer_phone": {"$regex": pattern, "$options": "i"}},
        ]

    if payment_method:
        query["payment_method"] = payment_method

    start = _parse_date_ist(date_from)
    end = _parse_date_ist(date_to, end_of_day=True)
    if start or end:
        window = {}
        if start:
            window["$gte"] = start
        if end:
            window["$lt"] = end
        query["billed_at"] = window

    total = await db[BILLS_COLLECTION].count_documents(query)

    revenue = 0.0
    async for row in db[BILLS_COLLECTION].find(query, {"total_amount": 1}):
        revenue += row.get("total_amount", 0.0)

    cursor = (
        db[BILLS_COLLECTION]
        .find(query)
        .sort("billed_at", -1)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    results = [_serialize_bill(doc) async for doc in cursor]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {"bills": total, "revenue": round(revenue, 2)},
        "results": results,
    }


async def get_bill(kendra_id: str, bill_id: str, current_user=None) -> dict:
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    doc = await db[BILLS_COLLECTION].find_one(
        {"_id": _to_object_id(bill_id), "kendra_id": str(object_id)}
    )
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bill not found.",
        )
    return _serialize_bill(doc)


# ─────────────────────────────────────────────────────────────────────────────
# Shop details printed on invoices
# ─────────────────────────────────────────────────────────────────────────────

async def _last_bill_number(db, kendra_id: str) -> int:
    counter = await db[BILL_COUNTERS_COLLECTION].find_one({"_id": kendra_id})
    return int((counter or {}).get("seq", 0))


async def get_billing_details(kendra_id: str, current_user=None) -> dict:
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    return {
        "name": kendra.get("name"),
        "address": kendra.get("address"),
        "phone": kendra.get("phone"),
        "gstin": kendra.get("gstin"),
        "drug_license_no": kendra.get("drug_license_no"),
        "last_bill_number": await _last_bill_number(db, str(object_id)),
    }


async def update_billing_details(
    kendra_id: str,
    data: BillingDetailsRequest,
    current_user=None,
) -> dict:
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    await db[KENDRAS_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": {
            "gstin": data.gstin,
            "drug_license_no": data.drug_license_no,
        }},
    )

    if data.next_bill_number is not None:
        last = await _last_bill_number(db, str(object_id))
        if data.next_bill_number <= last:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Next bill number must be higher than the last one used ({last}), "
                    "otherwise two bills would share a number."
                ),
            )
        await db[BILL_COUNTERS_COLLECTION].update_one(
            {"_id": str(object_id)},
            {"$set": {"seq": data.next_bill_number - 1}},
            upsert=True,
        )

    return await get_billing_details(kendra_id, current_user)


# ─────────────────────────────────────────────────────────────────────────────
# Inventory dashboard
# ─────────────────────────────────────────────────────────────────────────────

async def get_inventory_dashboard(kendra_id: str, current_user=None) -> dict:
    """
    One-call summary for the pharmacy owner's Inventory Dashboard.

    Expired batches are NOT counted as sellable stock: a medicine whose only
    remaining stock has expired is shown as out of stock, and the expired
    units are listed separately so they can be removed.
    """
    db = get_database()
    object_id = _to_object_id(kendra_id)

    if current_user is not None:
        await _verify_kendra_ownership(kendra_id, current_user)

    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": object_id})
    if not kendra:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kendra not found.",
        )

    stock = kendra.get("stock", [])
    codes = [s["pmbi_code"] for s in stock]
    catalogue = {}
    if codes:
        async for med in db[MEDICINES_COLLECTION].find({"pmbi_code": {"$in": codes}}):
            catalogue[med["pmbi_code"]] = med

    now = datetime.now(timezone.utc)

    low_stock, out_of_stock, near_expiry, expired = [], [], [], []
    in_stock_count = 0
    total_units = 0
    inventory_value = 0.0

    for item in stock:
        code = item["pmbi_code"]
        med = catalogue.get(code, {})
        name = med.get("brand_name") or med.get("generic_name") or code
        mrp = float(med.get("jan_aushadhi_mrp") or 0.0)

        sellable_qty = 0
        for batch in item.get("batches", []):
            qty = batch.get("quantity", 0)
            if qty <= 0:
                continue
            expiry = _as_utc(batch.get("expiry_date"))
            days_left = (expiry - now).days if expiry else None

            row = {
                "pmbi_code": code,
                "medicine_name": name,
                "batch_number": batch.get("batch_number"),
                "quantity": qty,
                "expiry_date": expiry,
                "days_left": days_left,
            }

            if expiry is not None and expiry <= now:
                expired.append(row)
                continue

            sellable_qty += qty
            inventory_value += qty * float(batch.get("selling_price") or mrp)

            if days_left is not None and days_left <= EXPIRY_AMBER_DAYS:
                near_expiry.append({
                    **row,
                    "level": "red" if days_left <= EXPIRY_RED_DAYS else "amber",
                })

        total_units += sellable_qty
        state = compute_stock_status(sellable_qty)
        line = {
            "pmbi_code": code,
            "medicine_name": name,
            "quantity": sellable_qty,
            "status": state,
        }
        if state == "in_stock":
            in_stock_count += 1
        elif state == "low_stock":
            low_stock.append(line)
        else:
            out_of_stock.append(line)

    low_stock.sort(key=lambda r: r["quantity"])
    near_expiry.sort(key=lambda r: r["days_left"])
    expired.sort(key=lambda r: r["days_left"])

    # ── Sales: today + last 7 days (India calendar days) ────────────────────
    today_start = _ist_day_start_utc(now)
    week_start = today_start - timedelta(days=6)

    trend = {}
    for offset in range(7):
        day = (week_start + timedelta(days=offset)).astimezone(IST)
        trend[f"{day:%Y-%m-%d}"] = 0.0

    sales_today = 0.0
    bills_today = 0
    sales_7_days = 0.0
    recent_sales = []

    async for bill in db[BILLS_COLLECTION].find(
        {"kendra_id": str(object_id), "billed_at": {"$gte": week_start}}
    ):
        billed_at = _as_utc(bill["billed_at"])
        amount = bill.get("total_amount", 0.0)
        sales_7_days += amount
        key = f"{billed_at.astimezone(IST):%Y-%m-%d}"
        if key in trend:
            trend[key] += amount
        if billed_at >= today_start:
            sales_today += amount
            bills_today += 1

    # ── Recent activity: restocks + sales, newest first ─────────────────────
    activities = []

    async for act in db[ACTIVITIES_COLLECTION].find({"kendra_id": str(object_id)}):
        med = catalogue.get(act.get("pmbi_code"), {})
        name = med.get("brand_name") or act.get("pmbi_code")
        activities.append({
            "type": "restock",
            "title": f"Restocked {name}",
            "detail": f"+{act.get('quantity', 0)} units · batch {act.get('batch_number', '-')}",
            "at": _as_utc(act["at"]),
        })

    async for bill in db[BILLS_COLLECTION].find({"kendra_id": str(object_id)}):
        item_count = sum(i.get("quantity", 0) for i in bill.get("items", []))
        number = bill.get("bill_number") or f"JA-{str(bill['_id'])[-8:].upper()}"
        activities.append({
            "type": "sale",
            "title": f"Bill {number}",
            "detail": f"{item_count} units · ₹{bill.get('total_amount', 0):.2f}",
            "at": _as_utc(bill["billed_at"]),
        })

    activities.sort(key=lambda a: a["at"], reverse=True)

    return {
        "kendra": {"id": str(object_id), "name": kendra.get("name", "")},
        "summary": {
            "total_medicines": len(stock),
            "total_units": total_units,
            "in_stock": in_stock_count,
            "low_stock": len(low_stock),
            "out_of_stock": len(out_of_stock),
            "near_expiry_batches": len(near_expiry),
            "expired_batches": len(expired),
            "inventory_value": round(inventory_value, 2),
            "sales_today": round(sales_today, 2),
            "bills_today": bills_today,
            "sales_7_days": round(sales_7_days, 2),
        },
        "low_stock": low_stock,
        "out_of_stock": out_of_stock,
        "near_expiry": near_expiry,
        "expired": expired,
        "sales_trend": [
            {"date": d, "total": round(t, 2)} for d, t in trend.items()
        ],
        "recent_activity": activities[:10],
    }