"""
MongoDB indexes.

Indexes make searches, bill history, notifications, logins and so on fast
when the database grows. Unique indexes also stop duplicate records
(two users with one e-mail, two medicines with one PMBI code, ...).

`ensure_indexes` runs at every start-up. Creating an index that already
exists does nothing, so it is safe to run again and again.
If one index cannot be created (for example a unique index while old
duplicate rows exist) the problem is logged and start-up continues.
"""
from pymongo import ASCENDING, DESCENDING

from app.utils.logger import logger

# (collection, keys, options)
INDEXES = [
    # ---- users
    ("users", [("email", ASCENDING)], {"unique": True, "name": "uniq_email"}),
    ("users", [("role", ASCENDING), ("status", ASCENDING)], {"name": "role_status"}),
    ("users", [("assigned_kendra_id", ASCENDING)], {"name": "assigned_kendra", "sparse": True}),

    # ---- medicines (catalogue)
    ("medicines", [("pmbi_code", ASCENDING)], {"unique": True, "name": "uniq_pmbi_code"}),
    ("medicines", [("category", ASCENDING)], {"name": "category"}),
    ("medicines", [("is_active", ASCENDING)], {"name": "is_active"}),

    # ---- kendras (stock lives inside the document)
    ("kendras", [("stock.pmbi_code", ASCENDING)], {"name": "stock_pmbi_code"}),
    ("kendras", [("is_active", ASCENDING)], {"name": "is_active"}),

    # ---- bills
    ("bills", [("kendra_id", ASCENDING), ("billed_at", DESCENDING)], {"name": "kendra_billed_at"}),
    ("bills", [("billed_at", DESCENDING)], {"name": "billed_at"}),
    ("bills", [("kendra_id", ASCENDING), ("bill_number", ASCENDING)], {"name": "kendra_bill_number"}),

    # ---- inventory activity log
    ("inventory_activities", [("kendra_id", ASCENDING), ("at", DESCENDING)], {"name": "kendra_at"}),

    # ---- supplier bill imports (duplicate-invoice check)
    ("stock_imports", [("kendra_id", ASCENDING), ("invoice_no_norm", ASCENDING), ("supplier_norm", ASCENDING)],
     {"name": "kendra_invoice_supplier"}),

    # ---- pharmacy owner requests
    ("pharmacy_requests", [("status", ASCENDING)], {"name": "status"}),
    ("pharmacy_requests", [("email", ASCENDING), ("status", ASCENDING)], {"name": "email_status"}),

    # ---- "notify me" subscriptions and notifications
    ("stock_alert_subscriptions", [("pmbi_code", ASCENDING), ("is_active", ASCENDING)], {"name": "pmbi_active"}),
    ("stock_alert_subscriptions", [("user_email", ASCENDING), ("pmbi_code", ASCENDING)], {"name": "user_pmbi"}),
    ("notifications", [("user_email", ASCENDING), ("created_at", DESCENDING)], {"name": "user_created"}),
    ("notifications", [("user_email", ASCENDING), ("is_read", ASCENDING)], {"name": "user_read"}),

    # ---- refresh tokens (expired ones are deleted automatically by MongoDB)
    ("refresh_tokens", [("token_hash", ASCENDING)], {"unique": True, "name": "uniq_token_hash"}),
    ("refresh_tokens", [("user_id", ASCENDING)], {"name": "user_id"}),
    ("refresh_tokens", [("expires_at", ASCENDING)], {"name": "ttl_expires_at", "expireAfterSeconds": 0}),

    # ---- admin audit log (newest first, filter by type)
    ("audit_logs", [("created_at", -1)], {"name": "created_at_desc"}),
    ("audit_logs", [("target_type", ASCENDING), ("created_at", -1)], {"name": "type_created"}),

    # ---- saved medicines (one row per user + medicine)
    ("saved_medicines", [("user", ASCENDING), ("pmbi_code", ASCENDING)], {"unique": True, "name": "uniq_user_medicine"}),

    # ---- saved ranking preferences
    ("user_ranking_preferences", [("user_id", ASCENDING)], {"unique": True, "name": "uniq_user_id"}),
]


async def ensure_indexes(db) -> dict:
    """Create every index above. Returns {"created_or_present": n, "failed": [names]}."""
    ok = 0
    failed = []
    for collection, keys, options in INDEXES:
        label = f"{collection}.{options['name']}"
        try:
            await db[collection].create_index(keys, **options)
            ok += 1
        except Exception as error:  # never stop the server because of an index
            failed.append(label)
            logger.warning(f"Could not create index {label}: {error}")
    logger.info(f"MongoDB indexes ready: {ok} ok, {len(failed)} failed")
    return {"created_or_present": ok, "failed": failed}