"""
Signed-in user's own account: edit profile, change password, saved medicines.
Everything is keyed by the account e-mail (the JWT subject).
"""

from datetime import datetime, timezone

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app.core.constants import MEDICINES_COLLECTION
from app.database.connection import get_database
from app.services.refresh_token_service import revoke_all_for_user
from app.utils.password import hash_password, verify_password

SAVED = "saved_medicines"
MAX_SAVED = 200


async def _user(email: str) -> dict:
    user = await get_database().users.find_one({"email": email})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")
    return user


def _profile(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "full_name": user.get("full_name"),
        "email": user.get("email"),
        "phone_number": user.get("phone_number"),
        "role": user.get("role"),
        "status": user.get("status"),
        "is_email_verified": user.get("is_email_verified", False),
    }


async def update_profile(email: str, full_name: str, phone_number: str) -> dict:
    user = await _user(email)
    await get_database().users.update_one(
        {"_id": user["_id"]},
        {"$set": {"full_name": full_name, "phone_number": phone_number}},
    )
    user.update(full_name=full_name, phone_number=phone_number)
    return _profile(user)


async def change_password(email: str, current_password: str, new_password: str) -> dict:
    user = await _user(email)
    if not verify_password(current_password, user.get("hashed_password", "")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    if current_password == new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different.")
    await get_database().users.update_one(
        {"_id": user["_id"]},
        {"$set": {"hashed_password": hash_password(new_password)}},
    )
    # Sign out every other device; this one gets a fresh login on next refresh.
    await revoke_all_for_user(user["_id"])
    return {"message": "Password changed. Please sign in again."}


# ───────────────────────── saved medicines ─────────────────────────
async def list_saved(email: str) -> dict:
    db = get_database()
    rows = [r async for r in db[SAVED].find({"user": email}).sort("created_at", -1).limit(MAX_SAVED)]
    codes = [r["pmbi_code"] for r in rows]
    meds = {
        m["pmbi_code"]: m
        async for m in db[MEDICINES_COLLECTION].find({"pmbi_code": {"$in": codes}})
    }
    items = []
    for r in rows:
        m = meds.get(r["pmbi_code"])
        if not m:  # medicine was deleted from the catalogue
            continue
        items.append({
            "id": str(m["_id"]),
            "pmbi_code": m["pmbi_code"],
            "brand_name": m.get("brand_name"),
            "generic_name": m.get("generic_name"),
            "composition": m.get("composition"),
            "category": m.get("category"),
            "jan_aushadhi_mrp": m.get("jan_aushadhi_mrp"),
            "branded_avg_mrp": m.get("branded_avg_mrp"),
            "saving_pct": m.get("saving_pct"),
            "saved_at": r["created_at"],
        })
    return {"items": items, "total": len(items)}


async def save_medicine(email: str, pmbi_code: str) -> dict:
    db = get_database()
    if not await db[MEDICINES_COLLECTION].find_one({"pmbi_code": pmbi_code}, {"_id": 1}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medicine not found.")
    if await db[SAVED].count_documents({"user": email}) >= MAX_SAVED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"You can save up to {MAX_SAVED} medicines.")
    try:
        await db[SAVED].insert_one({
            "user": email, "pmbi_code": pmbi_code, "created_at": datetime.now(timezone.utc),
        })
    except DuplicateKeyError:
        pass  # already saved: saving twice is not an error
    return {"saved": True, "pmbi_code": pmbi_code}


async def unsave_medicine(email: str, pmbi_code: str) -> dict:
    await get_database()[SAVED].delete_one({"user": email, "pmbi_code": pmbi_code})
    return {"saved": False, "pmbi_code": pmbi_code}