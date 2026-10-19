"""
Supplier-bill OCR endpoint  (used by "Import stock from supplier bill")

    POST /api/v1/ocr/bill      multipart field "file"  (JPG / PNG / WEBP, max 10 MB)

It only READS the text. It returns every text box PaddleOCR found, with its
position and tilt, and the main backend (port 8002) turns those boxes back into
table rows. Nothing here knows about medicines or stock.

Why a separate endpoint from /prescription?
  * a printed bill needs ONE PaddleOCR pass - the prescription endpoint runs two
    passes plus a handwriting model, which is much slower
  * the bill reader needs the tilt angle of each line to rebuild table rows
"""

import asyncio
import math
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, ImageOps

from app.ocr_engine import get_ocr_engine

router = APIRouter()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_SIDE = 2000          # a 12 MP phone photo is shrunk to this before OCR (much faster, same accuracy)


def _prepare_image(source_path: str) -> tuple[str, int, int]:
    """Fix phone rotation (EXIF), shrink very large photos, save as a temporary JPEG."""
    with Image.open(source_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")

    width, height = image.size
    longest = max(width, height)
    if longest > MAX_SIDE:
        factor = MAX_SIDE / longest
        image = image.resize((round(width * factor), round(height * factor)), Image.LANCZOS)

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    handle.close()
    image.save(handle.name, "JPEG", quality=92)
    return handle.name, image.size[0], image.size[1]


def _read_lines(image_path: str) -> list[dict[str, Any]]:
    ocr = get_ocr_engine()
    lines: list[dict[str, Any]] = []

    for prediction in ocr.predict(image_path):
        result = prediction.json
        data = result.get("res", result)

        texts = data.get("rec_texts", [])
        scores = data.get("rec_scores", [])
        polygons = data.get("rec_polys", [])

        for index, text in enumerate(texts):
            text = str(text).strip()
            if not text:
                continue

            box = None
            angle = None
            try:
                points = [[float(p[0]), float(p[1])] for p in polygons[index]]
                xs = [p[0] for p in points]
                ys = [p[1] for p in points]
                box = [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]
                # tilt of the top edge (top-left -> top-right), in degrees
                angle = round(
                    math.degrees(math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0])), 2
                )
            except (IndexError, TypeError, ValueError):
                pass

            if box is None:
                continue

            lines.append({
                "text": text,
                "confidence": round(float(scores[index]), 4) if index < len(scores) else 0.0,
                "box": box,
                "angle": angle,
            })
    return lines


@router.post("/api/v1/ocr/bill")
async def scan_bill(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Only JPG, PNG and WEBP images are allowed.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Image size must not exceed 10 MB.")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"

    started = time.perf_counter()
    original_path = prepared_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            handle.write(image_bytes)
            original_path = handle.name

        prepared_path, width, height = await asyncio.to_thread(_prepare_image, original_path)
        print("[OCR] Reading supplier bill with PaddleOCR", flush=True)
        lines = await asyncio.to_thread(_read_lines, prepared_path)

        seconds = round(time.perf_counter() - started, 2)
        print(f"[OCR] Bill read: {len(lines)} text boxes in {seconds}s", flush=True)

        return {
            "lines": lines,
            "line_count": len(lines),
            "image_width": width,
            "image_height": height,
            "seconds": seconds,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Unable to read the bill: {error}")
    finally:
        for path in (original_path, prepared_path):
            if path and os.path.exists(path):
                os.remove(path)