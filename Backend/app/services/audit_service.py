"""
Admin audit log: who changed what, and when.

record() is best-effort: a logging failure must never break the admin action
that already succeeded, so it only logs the error.
"""

import re
from datetime import datetime, timezone

from app.database.connection import get_database
from app.utils.logger import logger

COLLECTION = "audit_logs"


async def record(actor: str, action: str, target_type: str, target_id: str = "",
                 summary: str = "", details: dict | None = None) -> None:
    try:
        await get_database()[COLLECTION].insert_one({
            "actor": actor,
            "action": action,              # e.g. "medicine.hide"
            "target_type": target_type,    # user | medicine | kendra | pharmacy_request
            "target_id": str(target_id or ""),
            "summary": summary,
            "details": details or {},
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as error:  # noqa: BLE001
        logger.error(f"Audit log write failed ({action}): {error}")


async def list_logs(q: str = "", target_type: str | None = None, actor: str | None = None,
                    page: int = 1, page_size: int = 20) -> dict:
    db = get_database()
    query: dict = {}
    if target_type:
        query["target_type"] = target_type
    if actor:
        query["actor"] = actor
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"summary": rx}, {"action": rx}, {"target_id": rx}, {"actor": rx}]

    total = await db[COLLECTION].count_documents(query)
    cursor = (db[COLLECTION].find(query).sort([("created_at", -1), ("_id", -1)])
              .skip((page - 1) * page_size).limit(page_size))
    items = []
    async for doc in cursor:
        items.append({
            "id": str(doc["_id"]),
            "actor": doc.get("actor"),
            "action": doc.get("action"),
            "target_type": doc.get("target_type"),
            "target_id": doc.get("target_id"),
            "summary": doc.get("summary"),
            "details": doc.get("details", {}),
            "created_at": doc.get("created_at"),
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size}