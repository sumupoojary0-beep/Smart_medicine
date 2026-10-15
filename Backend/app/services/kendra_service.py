from datetime import datetime, timezone
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.database.connection import get_database
from app.core.constants import KENDRAS_COLLECTION, MEDICINES_COLLECTION, BILLS_COLLECTION
from app.schemas.kendra_schemas import RestockRequest, BillRequest
from app.utils.geo import haversine_km
from app.utils.logger import logger
from app.services.notification_service import notify_stock_alert_subscribers

DEFAULT_RADIUS_KM = 5.0


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
        "distance": 0.35,
        "price": 0.25,
        "quantity": 0.20,
        "freshness": 0.10,
        "trust": 0.10,
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

    stock = kendra.get("stock", [])
    new_batch = {
        "batch_number": data.batch_number,
        "expiry_date": data.expiry_date,
        "quantity": data.quantity,
        "manufacturer": data.manufacturer,
    }

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

    await db[KENDRAS_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": {"stock": stock}},
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

    logger.info(f"Restocked {data.pmbi_code} at kendra {kendra_id}: +{data.quantity}")

    return {
        "message": "Stock added successfully.",
        "pmbi_code": data.pmbi_code,
        "batch_number": data.batch_number,
    }


def _deduct_fifo(batches: list, quantity_needed: int) -> tuple[list, list]:
    """
    Deduct quantity_needed from batches, oldest-expiry-first.
    Returns (remaining_batches, deduction_log).
    Raises HTTPException if total stock is insufficient.
    """
    available = sum(b["quantity"] for b in batches)
    if available < quantity_needed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient stock. Requested {quantity_needed}, available {available}.",
        )

    sorted_batches = sorted(batches, key=lambda b: b["expiry_date"])
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

    return result_batches, deduction_log


async def generate_bill(kendra_id: str, data: BillRequest, current_user=None) -> dict:
    """
    Generate a bill for one or more medicines sold.
    For each line item: deducts stock FIFO (oldest expiry first),
    recomputes total_qty + status, and records the sale.
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
    line_items = []
    total_amount = 0.0

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

        unit_price = medicine["jan_aushadhi_mrp"]
        line_total = round(unit_price * item.quantity, 2)
        total_amount += line_total

        line_items.append({
            "pmbi_code": item.pmbi_code,
            "medicine_name": medicine["brand_name"],
            "quantity": item.quantity,
            "unit_price": unit_price,
            "line_total": line_total,
            "batches_used": deduction_log,
        })

    # Persist updated stock (FIFO deduction applied)
    await db[KENDRAS_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": {"stock": stock}},
    )

    billed_at = datetime.now(timezone.utc)
    bill_doc = {
        "kendra_id": str(object_id),
        "items": line_items,
        "total_amount": round(total_amount, 2),
        "billed_at": billed_at,
    }
    result = await db[BILLS_COLLECTION].insert_one(bill_doc)

    logger.info(f"Bill generated at kendra {kendra_id}: {result.inserted_id}, total ₹{total_amount}")

    return {
        "bill_id": str(result.inserted_id),
        "kendra_id": str(object_id),
        "items": line_items,
        "total_amount": round(total_amount, 2),
        "billed_at": billed_at,
    }