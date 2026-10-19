"""
Admin management of Jan Aushadhi Kendras: list, add, edit, hide (deactivate),
delete, and remove an owner.

Safety rules
  * A Kendra with an owner, bills or a pending request cannot be deleted - hide
    it (deactivate) instead, so sales history is never lost.
  * Removing an owner turns that user back into a normal patient.
"""

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.database.connection import get_database
from app.schemas.admin_kendra_schemas import KendraWrite
from app.utils.constants import UserRole

KENDRAS = "kendras"
BILLS = "bills"
REQUESTS = "pharmacy_requests"


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Kendra id.")


def _row(doc: dict, owner: dict | None, pending: bool) -> dict:
    coords = (doc.get("location") or {}).get("coordinates") or [None, None]
    return {
        "id": str(doc["_id"]),
        "name": doc.get("name", ""),
        "address": doc.get("address", ""),
        "phone": doc.get("phone"),
        "longitude": coords[0],
        "latitude": coords[1],
        "is_active": doc.get("is_active", True) is not False,
        "medicines": len(doc.get("stock", [])),
        "owner": (
            {"name": owner.get("full_name"), "email": owner.get("email")} if owner else None
        ),
        "has_pending_request": pending,
    }


async def list_kendras(q: str = "") -> dict:
    db = get_database()
    owners = {}
    async for user in db.users.find({"assigned_kendra_id": {"$ne": None}}):
        if user.get("assigned_kendra_id"):
            owners[user["assigned_kendra_id"]] = user
    pending = set()
    async for req in db[REQUESTS].find({"status": "PENDING"}):
        pending.add(req["kendra_id"])

    needle = (q or "").strip().lower()
    rows = []
    async for doc in db[KENDRAS].find({}):
        text = f"{doc.get('name', '')} {doc.get('address', '')}".lower()
        if needle and needle not in text:
            continue
        kid = str(doc["_id"])
        rows.append(_row(doc, owners.get(kid), kid in pending))
    rows.sort(key=lambda r: r["name"].lower())
    return {
        "kendras": rows,
        "total": len(rows),
        "active": sum(1 for r in rows if r["is_active"]),
        "without_owner": sum(1 for r in rows if r["owner"] is None),
    }


def _document(data: KendraWrite) -> dict:
    return {
        "name": data.name,
        "address": data.address,
        "phone": data.phone,
        "is_active": data.is_active,
        "location": {"type": "Point", "coordinates": [data.longitude, data.latitude]},
    }


async def _name_taken(db, name: str, exclude: ObjectId | None = None) -> bool:
    lowered = name.strip().lower()
    async for doc in db[KENDRAS].find({}):
        if exclude and doc["_id"] == exclude:
            continue
        if doc.get("name", "").strip().lower() == lowered:
            return True
    return False


async def create_kendra(data: KendraWrite) -> dict:
    db = get_database()
    if await _name_taken(db, data.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "A Kendra with this name already exists.")
    doc = _document(data)
    doc.update({"stock": [], "rating": None, "created_at": datetime.now(timezone.utc)})
    result = await db[KENDRAS].insert_one(doc)
    return _row({**doc, "_id": result.inserted_id}, None, False)


async def update_kendra(kendra_id: str, data: KendraWrite) -> dict:
    db = get_database()
    oid = _oid(kendra_id)
    if not await db[KENDRAS].find_one({"_id": oid}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kendra not found.")
    if await _name_taken(db, data.name, exclude=oid):
        raise HTTPException(status.HTTP_409_CONFLICT, "A Kendra with this name already exists.")
    await db[KENDRAS].update_one({"_id": oid}, {"$set": _document(data)})
    fresh = await db[KENDRAS].find_one({"_id": oid})
    owner = await db.users.find_one({"assigned_kendra_id": kendra_id})
    return _row(fresh, owner, False)


async def set_active(kendra_id: str, active: bool) -> dict:
    db = get_database()
    oid = _oid(kendra_id)
    if not await db[KENDRAS].find_one({"_id": oid}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kendra not found.")
    await db[KENDRAS].update_one({"_id": oid}, {"$set": {"is_active": active}})
    return {
        "message": "Kendra is visible to patients again." if active else "Kendra hidden from patient search.",
        "is_active": active,
    }


async def delete_kendra(kendra_id: str) -> dict:
    db = get_database()
    oid = _oid(kendra_id)
    kendra = await db[KENDRAS].find_one({"_id": oid})
    if not kendra:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kendra not found.")

    if await db.users.find_one({"assigned_kendra_id": kendra_id}):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Kendra has an owner. Remove the owner first, or hide the Kendra instead.",
        )
    if await db[REQUESTS].find_one({"kendra_id": kendra_id, "status": "PENDING"}):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A pharmacy request for this Kendra is waiting. Decide on it first.",
        )
    if await db[BILLS].find_one({"kendra_id": kendra_id}):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Kendra has sales history, so it cannot be deleted. Hide it instead.",
        )

    await db[KENDRAS].delete_one({"_id": oid})
    return {"message": f"Deleted {kendra.get('name', 'Kendra')}."}


async def remove_owner(kendra_id: str) -> dict:
    db = get_database()
    _oid(kendra_id)
    owner = await db.users.find_one({"assigned_kendra_id": kendra_id})
    if not owner:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This Kendra has no owner.")
    if owner.get("role") == UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The linked account is an admin; not changed.")
    await db.users.update_one(
        {"_id": owner["_id"]},
        {"$set": {"role": UserRole.USER.value, "assigned_kendra_id": None}},
    )
    return {"message": f"{owner.get('full_name') or owner['email']} no longer manages this Kendra."}