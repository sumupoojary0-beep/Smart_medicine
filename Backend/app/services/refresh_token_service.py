"""
Refresh tokens.

The short-lived access token (JWT) is renewed with a long-lived, random,
single-use refresh token. Only a SHA-256 hash of each refresh token is stored.

  * every refresh rotates the token (old one is revoked, a new one is issued)
  * presenting an already-used token revokes ALL of that user's tokens
    (a stolen-token signal)
  * suspended / deleted / unverified users cannot refresh
  * logout, password reset and suspension revoke tokens
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from app.core.config import settings
from app.database.connection import get_database
from app.utils.constants import UserStatus
from app.utils.jwt_helper import create_access_token
from app.utils.logger import logger

COLLECTION = "refresh_tokens"


def _days() -> int:
    return int(getattr(settings, "REFRESH_TOKEN_EXPIRE_DAYS", 7))


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _unauthorized(detail: str = "Session expired. Please sign in again.") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail)


async def issue_refresh_token(user: dict) -> str:
    """Create and store a new refresh token for `user`; return the raw token."""
    db = get_database()
    raw = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    await db[COLLECTION].insert_one({
        "token_hash": _hash(raw),
        "user_id": str(user["_id"]),
        "created_at": now,
        "expires_at": now + timedelta(days=_days()),
        "revoked": False,
    })
    return raw


async def revoke_all_for_user(user_id) -> None:
    await get_database()[COLLECTION].update_many(
        {"user_id": str(user_id), "revoked": False},
        {"$set": {"revoked": True}},
    )


async def revoke_refresh_token(raw: str) -> None:
    """Logout: revoke one token (no error if unknown)."""
    if raw:
        await get_database()[COLLECTION].update_one(
            {"token_hash": _hash(raw)}, {"$set": {"revoked": True}}
        )


async def rotate_refresh_token(raw: str) -> dict:
    """Exchange a valid refresh token for a new access + refresh token."""
    db = get_database()
    record = await db[COLLECTION].find_one({"token_hash": _hash(raw or "")})
    if not record:
        raise _unauthorized()

    if record.get("revoked"):
        # Token reuse: assume it leaked, sign the user out everywhere.
        await revoke_all_for_user(record["user_id"])
        logger.warning(f"Refresh token reuse detected for user id {record['user_id']}")
        raise _unauthorized()

    expires_at = record["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        await db[COLLECTION].update_one({"_id": record["_id"]}, {"$set": {"revoked": True}})
        raise _unauthorized()

    from bson import ObjectId
    try:
        user = await db.users.find_one({"_id": ObjectId(record["user_id"])})
    except Exception:
        user = None
    if not user:
        raise _unauthorized()
    if user.get("status") != UserStatus.ACTIVE or not user.get("is_email_verified", False):
        await revoke_all_for_user(user["_id"])
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account is inactive.")

    await db[COLLECTION].update_one({"_id": record["_id"]}, {"$set": {"revoked": True}})
    return {
        "access_token": create_access_token({"sub": user["email"], "role": user["role"]}),
        "refresh_token": await issue_refresh_token(user),
        "token_type": "bearer",
    }