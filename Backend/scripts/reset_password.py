"""
Set a new password for an existing account (use when you forgot it).

From the Backend folder, with your venv active:

    python scripts/reset_password.py you@example.com

It asks for the new password (typing is hidden). Then sign in normally.
The 'Forgot password' page in the app is not connected to the backend yet.
"""

import asyncio
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.utils.password import hash_password  # noqa: E402


async def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 1

    email = argv[0].strip().lower()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.DATABASE_NAME]
    try:
        user = await db.users.find_one({"email": email})
        if not user:
            print(f"No account found for {email}.")
            return 1

        password = getpass.getpass("New password (min 8 characters): ")
        if len(password) < 8:
            print("Too short - nothing changed.")
            return 1
        if getpass.getpass("Type it again: ") != password:
            print("The two passwords do not match - nothing changed.")
            return 1

        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"hashed_password": hash_password(password)},
             "$unset": {"otp_hash": "", "otp_expires_at": ""}},
        )
        print(f"Password changed for {email}. You can sign in now.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))