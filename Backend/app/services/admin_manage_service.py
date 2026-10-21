"""
Admin: dashboard overview, user management, medicine catalogue management.
All numbers come from the real collections (users, kendras, medicines, bills).
"""

import re
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.database.connection import get_database
from app.schemas.admin_manage_schemas import MedicineWrite
from app.services.admin_service import (
    get_demand_analytics,
    get_expiry_overview,
    get_inventory_overview,
)

REQUESTS = "pharmacy_requests"


def _utc(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id.")


# ───────────────────────────── overview ────────────────────────────────────
async def get_overview() -> dict:
    db = get_database()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    by_role = {"USER": 0, "PHARMACY": 0, "ADMIN": 0}
    unverified = suspended = new_7d = 0
    users = []
    async for user in db.users.find({}):
        users.append(user)
        by_role[user.get("role", "USER")] = by_role.get(user.get("role", "USER"), 0) + 1
        unverified += 0 if user.get("is_email_verified") else 1
        suspended += 0 if user.get("status", "ACTIVE") == "ACTIVE" else 1
        created = _utc(user.get("created_at"))
        if created and created >= week_ago:
            new_7d += 1
    users.sort(key=lambda u: _utc(u.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    owned = {u["assigned_kendra_id"] for u in users if u.get("assigned_kendra_id")}
    kendra_total = kendra_active = 0
    without_owner = 0
    async for kendra in db["kendras"].find({}):
        kendra_total += 1
        kendra_active += 0 if kendra.get("is_active") is False else 1
        without_owner += 0 if str(kendra["_id"]) in owned else 1

    pending = []
    pending_count = 0
    async for req in db[REQUESTS].find({"status": "PENDING"}):
        pending_count += 1
        pending.append({
            "id": str(req["_id"]), "full_name": req.get("full_name"),
            "kendra_name": req.get("kendra_name"), "created_at": req.get("created_at"),
        })
    pending.sort(key=lambda r: _utc(r["created_at"]) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    med_total = med_hidden = 0
    async for med in db["medicines"].find({}):
        med_total += 1
        med_hidden += 1 if med.get("is_active") is False else 0

    inventory = await get_inventory_overview()
    expiry = await get_expiry_overview()
    analytics = await get_demand_analytics(7)

    return {
        "users": {"total": len(users), "by_role": by_role, "unverified": unverified,
                  "suspended": suspended, "new_7_days": new_7d},
        "kendras": {"total": kendra_total, "active": kendra_active, "without_owner": without_owner},
        "medicines": {"total": med_total, "hidden": med_hidden},
        "pending_requests": {"count": pending_count, "latest": pending[:5]},
        "stock": {**inventory["totals"], **expiry["summary"]},
        "sales": {
            "revenue": analytics["revenue"], "orders": analytics["orders"],
            "daily_trend": analytics["daily_trend"], "top_selling": analytics["top_selling"][:5],
        },
        "recent_signups": [
            {"id": str(u["_id"]), "full_name": u.get("full_name"), "email": u.get("email"),
             "role": u.get("role"), "created_at": u.get("created_at")}
            for u in users[:5]
        ],
    }


# ───────────────────────────── users ───────────────────────────────────────
def _user_row(user: dict, kendra_names: dict) -> dict:
    kid = user.get("assigned_kendra_id")
    return {
        "id": str(user["_id"]),
        "full_name": user.get("full_name"),
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "role": user.get("role", "USER"),
        "status": user.get("status", "ACTIVE"),
        "is_email_verified": bool(user.get("is_email_verified")),
        "created_at": user.get("created_at"),
        "last_login": user.get("last_login"),
        "kendra_name": kendra_names.get(kid) if kid else None,
    }


async def list_users(q: str, role: str | None, status_filter: str | None, page: int, page_size: int) -> dict:
    db = get_database()
    query: dict = {}
    if q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [{f: {"$regex": pattern, "$options": "i"}} for f in ("full_name", "email", "phone_number")]
    if role:
        query["role"] = role
    if status_filter:
        query["status"] = status_filter

    total = await db.users.count_documents(query)
    rows = []
    async for user in db.users.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size):
        rows.append(user)

    kendra_names = {}
    ids = [u["assigned_kendra_id"] for u in rows if u.get("assigned_kendra_id")]
    for kid in ids:
        kendra = await db["kendras"].find_one({"_id": _oid(kid)})
        if kendra:
            kendra_names[kid] = kendra.get("name")
    return {
        "total": total, "page": page, "page_size": page_size,
        "results": [_user_row(u, kendra_names) for u in rows],
    }


async def _target(db, user_id: str, actor_email: str) -> dict:
    user = await db.users.find_one({"_id": _oid(user_id)})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    if user.get("email") == actor_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own account here.")
    return user


async def set_user_status(user_id: str, new_status: str, actor_email: str) -> dict:
    db = get_database()
    user = await _target(db, user_id, actor_email)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"status": new_status}})
    if new_status != "ACTIVE":
        from app.services.refresh_token_service import revoke_all_for_user
        await revoke_all_for_user(user["_id"])
    return {"message": ("Account re-activated." if new_status == "ACTIVE" else
                        "Account suspended. They can no longer sign in."), "status": new_status}


async def set_user_role(user_id: str, new_role: str, actor_email: str) -> dict:
    db = get_database()
    user = await _target(db, user_id, actor_email)
    if not user.get("is_email_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This user has not verified their e-mail yet.")
    # PHARMACY owners are linked to a Kendra, so any change here also unlinks it
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"role": new_role, "assigned_kendra_id": None}},
    )
    return {"message": f"Role changed to {new_role}. They must log in again.", "role": new_role}


# ───────────────────────────── medicines ───────────────────────────────────
def _med_row(doc: dict) -> dict:
    return {
        "pmbi_code": doc.get("pmbi_code"),
        "generic_name": doc.get("generic_name"),
        "brand_name": doc.get("brand_name"),
        "composition": doc.get("composition"),
        "category": doc.get("category"),
        "jan_aushadhi_mrp": doc.get("jan_aushadhi_mrp", 0),
        "branded_avg_mrp": doc.get("branded_avg_mrp", 0),
        "saving_pct": doc.get("saving_pct", 0),
        "pack_size": doc.get("pack_size", ""),
        "manufacturer": doc.get("manufacturer", ""),
        "is_active": doc.get("is_active", True) is not False,
    }


async def list_medicines(q: str, category: str | None, visibility: str, page: int, page_size: int) -> dict:
    db = get_database()
    query: dict = {}
    if q.strip():
        pattern = re.escape(q.strip())
        query["$or"] = [{f: {"$regex": pattern, "$options": "i"}}
                        for f in ("brand_name", "generic_name", "pmbi_code", "composition")]
    if category:
        query["category"] = category
    if visibility == "active":
        query["is_active"] = {"$ne": False}
    elif visibility == "hidden":
        query["is_active"] = False

    total = await db["medicines"].count_documents(query)
    rows = []
    async for doc in db["medicines"].find(query).sort("brand_name", 1).skip((page - 1) * page_size).limit(page_size):
        rows.append(_med_row(doc))

    categories = set()
    async for doc in db["medicines"].find({}):
        if doc.get("category"):
            categories.add(doc["category"])
    return {"total": total, "page": page, "page_size": page_size,
            "results": rows, "categories": sorted(categories)}


def _saving(data: MedicineWrite) -> float:
    if data.branded_avg_mrp <= 0:
        return 0.0
    return round(max(0.0, (data.branded_avg_mrp - data.jan_aushadhi_mrp) / data.branded_avg_mrp * 100), 2)


async def create_medicine(data: MedicineWrite) -> dict:
    db = get_database()
    if await db["medicines"].find_one({"pmbi_code": data.pmbi_code}):
        raise HTTPException(status.HTTP_409_CONFLICT, f"PMBI code {data.pmbi_code} already exists.")
    now = datetime.now(timezone.utc)
    doc = {**data.model_dump(), "saving_pct": _saving(data), "is_active": True,
           "created_at": now, "updated_at": now}
    await db["medicines"].insert_one(doc)
    return _med_row(doc)


async def update_medicine(code: str, data: MedicineWrite) -> dict:
    db = get_database()
    if not await db["medicines"].find_one({"pmbi_code": code}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medicine not found.")
    if data.pmbi_code != code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The PMBI code cannot be changed.")
    fields = {**data.model_dump(), "saving_pct": _saving(data), "updated_at": datetime.now(timezone.utc)}
    await db["medicines"].update_one({"pmbi_code": code}, {"$set": fields})
    return _med_row(await db["medicines"].find_one({"pmbi_code": code}))


async def set_medicine_active(code: str, active: bool) -> dict:
    db = get_database()
    if not await db["medicines"].find_one({"pmbi_code": code}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medicine not found.")
    await db["medicines"].update_one({"pmbi_code": code}, {"$set": {"is_active": active}})
    return {"message": "Medicine is visible in search again." if active else "Medicine hidden from search.",
            "is_active": active}