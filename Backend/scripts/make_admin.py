"""
Make an existing, verified user an ADMIN.

Admins cannot register through the website. Steps:
  1. Register a normal account in the app (/register) and verify the email OTP.
  2. From the Backend folder, with your venv active, run:

         python scripts/make_admin.py you@example.com

  3. Open http://localhost:5173/admin/login and sign in with that email and password.
     (If you were already logged in, log out first - the role is read at login.)

Undo (back to a normal user):   python scripts/make_admin.py you@example.com --remove
List current admins:            python scripts/make_admin.py --list
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.core.config import settings  # noqa: E402


async def main(argv: list[str]) -> int:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.DATABASE_NAME]
    try:
        if argv == ["--list"]:
            admins = await db.users.find({"role": "ADMIN"}).to_list(100)
            if not admins:
                print("No admins yet.")
            for a in admins:
                print(f"  - {a.get('full_name')}  <{a['email']}>")
            return 0

        if not argv or len(argv) > 2 or (len(argv) == 2 and argv[1] != "--remove"):
            print(__doc__)
            return 1

        email = argv[0].strip().lower()
        user = await db.users.find_one({"email": email})
        if not user:
            print(f"No account found for {email}. Register in the app first.")
            return 1

        if len(argv) == 2:  # --remove
            await db.users.update_one({"_id": user["_id"]}, {"$set": {"role": "USER"}})
            print(f"{email} is a normal user again.")
            return 0

        if not user.get("is_email_verified"):
            print(f"{email} has not verified the email OTP yet. Verify it first.")
            return 1
        await db.users.update_one(
            {"_id": user["_id"]},
            {"$set": {"role": "ADMIN", "assigned_kendra_id": None}},
        )
        print(f"Done: {email} is now an ADMIN.")
        print("Log out, then sign in at http://localhost:5173/admin/login")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))