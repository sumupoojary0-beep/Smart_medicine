"""
Forgot-password flow (e-mail OTP).

  POST /auth/forgot-password            -> forgot_password()      sends a 6-digit code
  POST /auth/verify-otp?flow=reset      -> check_reset_otp()      checks the code (does not use it up)
  POST /auth/resend-otp?flow=reset      -> forgot_password()      sends a fresh code
  POST /auth/reset-password             -> reset_password()       checks the code again + saves the new password

Safety
  * the answer to "forgot password" is the same whether or not the e-mail exists
  * the reset code is stored hashed, in its own fields (it never touches the sign-up OTP)
  * code expires after OTP_EXPIRE_MINUTES, is blocked after 5 wrong tries,
    and a new code cannot be requested more than once per 60 seconds
"""

from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import aiosmtplib
from fastapi import HTTPException, status

from app.core.config import settings
from app.database.connection import get_database
from app.utils.email_otp import generate_otp, hash_otp, verify_otp_hash
from app.utils.logger import logger
from app.utils.password import hash_password

MAX_TRIES = 5
RESEND_SECONDS = 60
GENERIC = "If an account exists for this e-mail, a reset code has been sent."


def _email(value: str) -> str:
    return value.strip().lower()


def _utc(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _send_reset_email(to: str, name: str, otp: str) -> None:
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = to
    message["Subject"] = "Reset your Smart Medicine password"
    message.set_content(
        f"""
Hello {name},

Your Smart Medicine System password reset code is:

{otp}

This code expires in {settings.OTP_EXPIRE_MINUTES} minutes.

If you did not ask to reset your password, ignore this e-mail.
Your password stays the same.

Regards,
Smart Medicine System
        """.strip()
    )
    await aiosmtplib.send(
        message,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USERNAME,
        password=settings.SMTP_PASSWORD,
        start_tls=True,
    )


async def forgot_password(email: str) -> dict:
    db = get_database()
    email = _email(email)
    user = await db.users.find_one({"email": email})

    # unknown or not-yet-verified account: say nothing different
    if not user or not user.get("is_email_verified"):
        return {"message": GENERIC, "email": email}

    now = datetime.now(timezone.utc)
    last = _utc(user.get("reset_otp_created_at"))
    if last and (now - last).total_seconds() < RESEND_SECONDS:
        wait = int(RESEND_SECONDS - (now - last).total_seconds()) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Please wait {wait} seconds before asking for another code.",
        )

    otp = generate_otp()
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "reset_otp_hash": hash_otp(otp),
            "reset_otp_expires_at": now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
            "reset_otp_created_at": now,
            "reset_otp_tries": 0,
        }},
    )
    try:
        await _send_reset_email(email, user.get("full_name") or "there", otp)
    except Exception as error:  # mail server problem
        logger.error(f"Reset OTP e-mail failed for {email}: {error}")
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The reset e-mail could not be sent. Please try again in a moment.",
        )
    logger.info(f"Password reset OTP sent to: {email}")
    return {"message": GENERIC, "email": email}


async def _check(db, email: str, otp: str) -> dict:
    """Validate the code. Returns the user document or raises."""
    bad = HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired code. Request a new one.")
    user = await db.users.find_one({"email": _email(email)})
    if not user or not user.get("reset_otp_hash") or not user.get("reset_otp_expires_at"):
        raise bad
    if datetime.now(timezone.utc) > _utc(user["reset_otp_expires_at"]):
        raise bad
    if user.get("reset_otp_tries", 0) >= MAX_TRIES:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many wrong codes. Request a new code.",
        )
    if not verify_otp_hash(otp, user["reset_otp_hash"]):
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"reset_otp_tries": user.get("reset_otp_tries", 0) + 1}},
        )
        raise bad
    return user


async def check_reset_otp(email: str, otp: str) -> dict:
    await _check(get_database(), email, otp)
    return {"message": "Code accepted. Choose a new password."}


async def reset_password(email: str, otp: str, new_password: str) -> dict:
    db = get_database()
    user = await _check(db, email, otp)
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"hashed_password": hash_password(new_password)},
         "$unset": {
             "reset_otp_hash": "", "reset_otp_expires_at": "",
             "reset_otp_created_at": "", "reset_otp_tries": "",
         }},
    )
    # a password change signs the account out everywhere
    from app.services.refresh_token_service import revoke_all_for_user
    await revoke_all_for_user(user["_id"])
    logger.info(f"Password reset completed for: {user['email']}")
    return {"message": "Password reset successful. You can sign in now."}