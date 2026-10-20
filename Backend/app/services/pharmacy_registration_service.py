"""
Pharmacy-owner registration.

Flow
  1. A shop owner fills the signup page (account details + which Kendra + licence).
     An ordinary account is created (role USER) and the normal e-mail OTP is sent.
     A request is saved as PENDING.
  2. The owner verifies the OTP and can sign in - but is still a normal user.
  3. An ADMIN opens "Pharmacy requests", checks the licence and approves.
     Approval sets role = PHARMACY and assigned_kendra_id on the user.

Why approval is needed: whoever holds assigned_kendra_id can change that Kendra's
stock and prices. Without a check anybody could claim any shop.
This replaces scripts/make_pharmacy_owner.py (which still works as a fallback).
"""

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.database.connection import get_database
from app.schemas.auth_schemas import RegisterRequest
from app.schemas.pharmacy_registration_schemas import PharmacyRegisterRequest
from app.services.auth_service import normalize_email, register_user
from app.utils.constants import UserRole

REQUESTS_COLLECTION = "pharmacy_requests"
KENDRAS_COLLECTION = "kendras"
VALID_STATUSES = ("PENDING", "APPROVED", "REJECTED")


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(doc: dict, kendra_name: str | None = None) -> dict:
    return {
        "id": str(doc["_id"]),
        "full_name": doc.get("full_name"),
        "email": doc.get("email"),
        "phone_number": doc.get("phone_number"),
        "kendra_id": doc.get("kendra_id"),
        "kendra_name": kendra_name or doc.get("kendra_name"),
        "license_no": doc.get("license_no"),
        "message": doc.get("message"),
        "status": doc.get("status"),
        "reject_reason": doc.get("reject_reason"),
        "email_verified": bool(doc.get("email_verified")),
        "created_at": doc.get("created_at"),
        "decided_at": doc.get("decided_at"),
    }


async def _owned_kendra_ids(db) -> set[str]:
    owned = set()
    async for user in db.users.find({"assigned_kendra_id": {"$ne": None}}):
        if user.get("assigned_kendra_id"):
            owned.add(user["assigned_kendra_id"])
    return owned


async def _pending_kendra_ids(db, exclude_email: str | None = None) -> set[str]:
    pending = set()
    async for req in db[REQUESTS_COLLECTION].find({"status": "PENDING"}):
        if exclude_email and req.get("email") == exclude_email:
            continue
        pending.add(req["kendra_id"])
    return pending


# ── Public: search Kendras that have no owner yet ───────────────────────────
async def search_open_kendras(q: str = "", limit: int = 20) -> dict:
    db = get_database()
    owned = await _owned_kendra_ids(db)
    pending = await _pending_kendra_ids(db)
    needle = (q or "").strip().lower()

    results = []
    async for kendra in db[KENDRAS_COLLECTION].find({"is_active": {"$ne": False}}):
        kid = str(kendra["_id"])
        if kid in owned:
            continue
        text = f"{kendra.get('name', '')} {kendra.get('address', '')}".lower()
        if needle and needle not in text:
            continue
        results.append({
            "id": kid,
            "name": kendra.get("name", ""),
            "address": kendra.get("address", ""),
            "has_pending_request": kid in pending,
        })
        if len(results) >= limit:
            break
    results.sort(key=lambda r: r["name"].lower())
    return {"results": results, "count": len(results)}


# ── Public: sign up as a pharmacy owner ─────────────────────────────────────
async def register_pharmacy_owner(data: PharmacyRegisterRequest) -> dict:
    db = get_database()
    kendra = await db[KENDRAS_COLLECTION].find_one({"_id": _oid(data.kendra_id)})
    if not kendra or kendra.get("is_active") is False:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kendra not found.")

    kid = str(kendra["_id"])
    if kid in await _owned_kendra_ids(db):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This Kendra already has a registered owner. Contact the admin if this is a mistake.",
        )
    email = normalize_email(data.email)
    # the same person retrying (e.g. never got the OTP) may re-submit their own request
    if kid in await _pending_kendra_ids(db, exclude_email=email):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Another request for this Kendra is already waiting for approval.",
        )

    # creates the account + sends the OTP (raises if the e-mail is taken / mail fails)
    result = await register_user(RegisterRequest(
        full_name=data.full_name,
        email=data.email,
        phone_number=data.phone_number,
        password=data.password,
    ))

    fields = {
        "email": email,
        "full_name": data.full_name.strip(),
        "phone_number": data.phone_number.strip(),
        "kendra_id": kid,
        "kendra_name": kendra.get("name", ""),
        "license_no": data.license_no,
        "message": data.message,
        "status": "PENDING",
        "reject_reason": None,
        "created_at": _now(),
        "decided_at": None,
        "decided_by": None,
    }
    # register_user lets an unverified e-mail sign up again; keep ONE pending request per person
    existing = await db[REQUESTS_COLLECTION].find_one({"email": email, "status": "PENDING"})
    if existing:
        fields.pop("created_at")
        await db[REQUESTS_COLLECTION].update_one({"_id": existing["_id"]}, {"$set": fields})
    else:
        await db[REQUESTS_COLLECTION].insert_one(fields)
    return {
        "message": (
            "Account created. Verify the OTP sent to your e-mail; "
            "an admin will then approve your pharmacy."
        ),
        "email": result.get("email", email),
        "request_status": "PENDING",
    }


# ── Signed in: my own request ───────────────────────────────────────────────
async def get_my_request(email: str) -> dict:
    db = get_database()
    req = None
    async for doc in db[REQUESTS_COLLECTION].find({"email": normalize_email(email)}):
        if req is None or doc["created_at"] > req["created_at"]:
            req = doc
    return {"request": _serialize(req) if req else None}


# ── Admin ───────────────────────────────────────────────────────────────────
async def list_requests(status_filter: str | None = None) -> dict:
    db = get_database()
    if status_filter and status_filter not in VALID_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid status.")

    query = {"status": status_filter} if status_filter else {}
    items = []
    async for doc in db[REQUESTS_COLLECTION].find(query):
        user = await db.users.find_one({"email": doc["email"]})
        item = _serialize(doc)
        item["email_verified"] = bool(user and user.get("is_email_verified"))
        items.append(item)
    items.sort(key=lambda r: r["created_at"], reverse=True)
    counts = {s: 0 for s in VALID_STATUSES}
    async for doc in db[REQUESTS_COLLECTION].find({}):
        counts[doc["status"]] = counts.get(doc["status"], 0) + 1
    return {"requests": items, "counts": counts}


async def _load_pending(db, request_id: str) -> dict:
    req = await db[REQUESTS_COLLECTION].find_one({"_id": _oid(request_id)})
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found.")
    if req["status"] != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, f"This request is already {req['status'].lower()}.")
    return req


async def approve_request(request_id: str, admin_email: str) -> dict:
    db = get_database()
    req = await _load_pending(db, request_id)

    user = await db.users.find_one({"email": req["email"]})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The applicant's account no longer exists.")
    if not user.get("is_email_verified"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The applicant has not verified their e-mail yet.")
    if user.get("role") == UserRole.ADMIN.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account is an admin.")

    if req["kendra_id"] in await _owned_kendra_ids(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "This Kendra already has an owner.")
    if not await db[KENDRAS_COLLECTION].find_one({"_id": _oid(req["kendra_id"])}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The Kendra no longer exists.")

    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"role": UserRole.PHARMACY.value, "assigned_kendra_id": req["kendra_id"]}},
    )
    await db[REQUESTS_COLLECTION].update_one(
        {"_id": req["_id"]},
        {"$set": {"status": "APPROVED", "decided_at": _now(), "decided_by": admin_email}},
    )
    return {"message": f"{req['full_name']} is now the owner of {req['kendra_name']}.", "status": "APPROVED"}


async def reject_request(request_id: str, admin_email: str, reason: str | None) -> dict:
    db = get_database()
    req = await _load_pending(db, request_id)
    await db[REQUESTS_COLLECTION].update_one(
        {"_id": req["_id"]},
        {"$set": {
            "status": "REJECTED",
            "reject_reason": (reason or "").strip() or None,
            "decided_at": _now(),
            "decided_by": admin_email,
        }},
    )
    return {"message": "Request rejected.", "status": "REJECTED"}