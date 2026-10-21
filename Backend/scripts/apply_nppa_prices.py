"""
Apply official NPPA ceiling prices to medicines that have no branded price.

Source : NPPA "Ceiling prices of scheduled formulations under DPCO 2013"
         (list updated 30.09.2020, nppa.gov.in).
Meaning: the ceiling price is the MAXIMUM a brand may charge for that
         formulation (per tablet/capsule, excl. GST). The comparison shown in
         the app is therefore "Jan Aushadhi price vs the NPPA maximum price
         for the same pack" — an upper bound, labelled as such.

Only medicines whose saving is currently 0 (no brand data) are touched,
and only when the match was exact (same ingredient, form, strength).

Run from the Backend folder, venv active:
    python scripts/apply_nppa_prices.py            # dry run: prints what would change
    python scripts/apply_nppa_prices.py --apply    # writes to MongoDB
"""
import asyncio
import json
import sys
from pathlib import Path

# Let `from app...` work when run as `python scripts/apply_nppa_prices.py`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# let Python find the `app` package when run as `python scripts/...` from Backend
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.core.config import settings  # noqa: E402

SOURCE = "NPPA ceiling price (list dated 30.09.2020)"
DATA = Path(__file__).with_name("nppa_matches.json")


async def main(apply: bool) -> None:
    rows = json.loads(DATA.read_text(encoding="utf-8"))
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.DATABASE_NAME]
    changed = skipped = missing = 0

    for r in rows:
        doc = await db.medicines.find_one({"pmbi_code": r["pmbi_code"]})
        if not doc:
            missing += 1
            continue
        if (doc.get("saving_pct") or 0) > 0 and not doc.get("price_source"):
            skipped += 1  # already has a researched brand price: keep it
            continue
        ja = float(doc["jan_aushadhi_mrp"])
        ceiling = float(r["nppa_pack_price"])
        if ceiling <= ja:
            skipped += 1
            continue
        pct = round((1 - ja / ceiling) * 100, 1)
        print(f"{doc['generic_name'][:48]:48} JA ₹{ja:<7} NPPA max ₹{ceiling:<8} -> {pct}%")
        if apply:
            await db.medicines.update_one(
                {"_id": doc["_id"]},
                {"$set": {
                    "branded_avg_mrp": ceiling,
                    "saving_pct": pct,
                    "price_source": SOURCE,
                }},
            )
        changed += 1

    print(f"\n{'Updated' if apply else 'Would update'}: {changed} | kept as is: {skipped} | not in DB: {missing}")
    if not apply:
        print("Dry run only. Re-run with --apply to write.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))