import difflib
import re
from typing import Optional
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.database.connection import get_database
from app.models.medicine_model import MedicineModel
from app.schemas.medicine_schemas import (
    MedicineCreateRequest,
    MedicineUpdateRequest,
)
from app.core.constants import MEDICINES_COLLECTION, MEDICINE_NOT_FOUND
from app.utils.constants import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.utils.logger import logger
from app.utils.brand_aliases import BRAND_TO_GENERIC, INGREDIENT_REGEX


def _serialize(doc: dict) -> dict:
    doc["id"] = str(doc["_id"])
    doc.pop("_id", None)
    return doc


def _to_object_id(medicine_id: str) -> ObjectId:
    try:
        return ObjectId(medicine_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid medicine id."
        )


async def create_medicine(data: MedicineCreateRequest) -> dict:
    """Add a new medicine to the catalog (Admin only)."""
    db = get_database()

    existing = await db[MEDICINES_COLLECTION].find_one({"pmbi_code": data.pmbi_code})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A medicine with pmbi_code '{data.pmbi_code}' already exists.",
        )

    new_medicine = MedicineModel(**data.dict())
    result = await db[MEDICINES_COLLECTION].insert_one(new_medicine.dict())

    logger.info(f"Medicine created: {data.brand_name} ({result.inserted_id})")

    return {
        "message": "Medicine created successfully.",
        "id": str(result.inserted_id),
    }


# =====================================================
# Brand / spelling fallback for search
# =====================================================

_QUERY_NOISE = {
    "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule",
    "capsules", "syrup", "inj", "injection", "mg", "ip",
}
_VOCAB_STOPWORDS = {
    "tablets", "tablet", "capsules", "capsule", "injection", "suspension",
    "gastro", "resistant", "resistance", "release", "prolonged",
    "sustained", "extended", "hydrochloride", "sodium", "potassium",
    "oral", "solution", "powder", "cream", "ointment", "drops", "syrup",
    "tablets", "enteric", "coated", "chewable", "dispersible", "eye",
}
_ingredient_vocab_cache: dict = {"words": None}


async def _ingredient_vocabulary(db) -> list[str]:
    """Distinct ingredient-like words from the catalogue (built once)."""
    if _ingredient_vocab_cache["words"] is None:
        words: set[str] = set()
        cursor = db[MEDICINES_COLLECTION].find(
            {"is_active": {"$ne": False}},
            {"generic_name": 1, "composition": 1},
        )
        async for doc in cursor:
            for field in ("composition", "generic_name"):
                for word in re.findall(r"[A-Za-z]{5,}", doc.get(field) or ""):
                    word = word.lower()
                    if word not in _VOCAB_STOPWORDS:
                        words.add(word)
        _ingredient_vocab_cache["words"] = sorted(words)
    return _ingredient_vocab_cache["words"]


def resolve_query_to_ingredients(
    query: str,
    vocabulary: list[str],
) -> Optional[tuple[list[str], str]]:
    """
    Turn a brand name or a misspelled ingredient into ingredient name(s).
    Returns (ingredients, how) or None when nothing can be resolved
    reliably. `how` is "brand" or "spelling".
    """
    cleaned = re.sub(r"[^a-z\s]", " ", query.lower())
    words = [w for w in cleaned.split() if w not in _QUERY_NOISE]
    if not words:
        return None

    for key in (" ".join(words[:2]), words[0]):
        if key in BRAND_TO_GENERIC:
            return list(BRAND_TO_GENERIC[key]), "brand"

    close_brand = difflib.get_close_matches(
        words[0], list(BRAND_TO_GENERIC), n=1, cutoff=0.85
    )
    if close_brand:
        return list(BRAND_TO_GENERIC[close_brand[0]]), "brand"

    close_word = difflib.get_close_matches(words[0], vocabulary, n=1, cutoff=0.8)
    if close_word:
        return [close_word[0]], "spelling"

    return None


def _ingredient_filter(ingredients: list[str]) -> dict:
    clauses = []
    for ingredient in ingredients:
        pattern = INGREDIENT_REGEX.get(ingredient, re.escape(ingredient))
        clauses.append(
            {
                "$or": [
                    {"generic_name": {"$regex": pattern, "$options": "i"}},
                    {"composition": {"$regex": pattern, "$options": "i"}},
                ]
            }
        )
    return {"$and": clauses}


def _rank_fallback_results(docs: list, ingredients: list[str], query: str) -> list:
    """
    Order brand/spelling-fallback results so the closest equivalents come
    first: a strength written in the query, then medicines whose
    ingredients are exactly the wanted ones (not combinations), then
    oral tablets/capsules, then everything else.
    """
    numbers = set(re.findall(r"\d+(?:\.\d+)?", query))

    def ingredient_count(doc: dict) -> int:
        text = doc.get("composition") or doc.get("generic_name") or ""
        parts = re.split(r"\s*(?:\+|,|&|\band\b)\s*", text, flags=re.IGNORECASE)
        return len([p for p in parts if re.search(r"[A-Za-z]{3,}", p)])

    def form_rank(doc: dict) -> int:
        name = (doc.get("generic_name") or "").lower()
        if re.search(r"\b(tablet|tablets|capsule|capsules|tab|caps)\b", name):
            return 0
        if re.search(r"\b(syrup|suspension|solution|drops)\b", name):
            return 1
        return 2

    def strength_hit(doc: dict) -> bool:
        if not numbers:
            return False
        text = f"{doc.get('generic_name', '')} {doc.get('composition', '')}"
        found = set(re.findall(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:mg|mcg|g|ml|iu)\b", text, flags=re.IGNORECASE))
        return bool(numbers & found)

    return sorted(
        docs,
        key=lambda d: (
            not strength_hit(d),
            abs(ingredient_count(d) - len(ingredients)),
            form_rank(d),
            d.get("brand_name", ""),
        ),
    )


SORTS = {"relevance", "price_asc", "price_desc", "name_asc", "name_desc"}


def _price_filter(min_price, max_price) -> Optional[dict]:
    clause: dict = {}
    if min_price is not None:
        clause["$gte"] = min_price
    if max_price is not None:
        clause["$lte"] = max_price
    return clause or None


def _mongo_sort(sort: str) -> list:
    """Server-side sort; ties are broken by name so paging is stable."""
    if sort == "price_asc":
        return [("jan_aushadhi_mrp", 1), ("brand_name", 1)]
    if sort == "price_desc":
        return [("jan_aushadhi_mrp", -1), ("brand_name", 1)]
    if sort == "name_desc":
        return [("brand_name", -1)]
    return [("brand_name", 1)]


def _sort_in_python(docs: list, sort: str) -> list:
    """Same sorts for the (small) ingredient-fallback result set."""
    if sort == "price_asc":
        return sorted(docs, key=lambda d: (d.get("jan_aushadhi_mrp") or 0, d.get("brand_name", "")))
    if sort == "price_desc":
        return sorted(docs, key=lambda d: (-(d.get("jan_aushadhi_mrp") or 0), d.get("brand_name", "")))
    if sort == "name_asc":
        return sorted(docs, key=lambda d: d.get("brand_name", ""))
    if sort == "name_desc":
        return sorted(docs, key=lambda d: d.get("brand_name", ""), reverse=True)
    return docs  # relevance: keep the ranking


async def search_medicines(
    query: Optional[str] = None,
    category: Optional[str] = None,
    page: int = DEFAULT_PAGE,
    page_size: int = DEFAULT_PAGE_SIZE,
    sort: str = "relevance",
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
) -> dict:
    """
    Search medicines by brand name, generic name, composition, or pmbi_code
    (case-insensitive partial match). Only active medicines are returned.
    """
    db = get_database()

    page = max(page, 1)
    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)

    mongo_filter: dict = {"is_active": {"$ne": False}}

    if query:
        safe_query = re.escape(query.strip())
        mongo_filter["$or"] = [
    {
        "brand_name": {
            "$regex": safe_query,
            "$options": "i",
        }
    },
    {
        "aliases": {
            "$regex": safe_query,
            "$options": "i",
        }
    },
    {
        "generic_name": {
            "$regex": safe_query,
            "$options": "i",
        }
    },
    {
        "composition": {
            "$regex": safe_query,
            "$options": "i",
        }
    },
    {
        "pmbi_code": {
            "$regex": safe_query,
            "$options": "i",
        }
    },
]

    if category:
        mongo_filter["category"] = category

    price_filter = _price_filter(min_price, max_price)
    if price_filter:
        mongo_filter["jan_aushadhi_mrp"] = price_filter

    total = await db[MEDICINES_COLLECTION].count_documents(mongo_filter)

    resolved_info = None

    # Nothing matched the typed text: the query may be a brand that is not
    # in the catalogue (e.g. "Amlodac") or a misspelled ingredient. Look up
    # its ingredient(s) and return the Jan Aushadhi generics instead.
    if total == 0 and query and query.strip():
        vocabulary = await _ingredient_vocabulary(db)
        resolution = resolve_query_to_ingredients(query, vocabulary)

        if resolution:
            ingredients, how = resolution
            fallback_filter: dict = {
                "is_active": {"$ne": False},
                **_ingredient_filter(ingredients),
            }
            if category:
                fallback_filter["category"] = category
            if price_filter:
                fallback_filter["jan_aushadhi_mrp"] = price_filter

            fallback_total = await db[MEDICINES_COLLECTION].count_documents(
                fallback_filter
            )
            if fallback_total:
                mongo_filter = fallback_filter
                total = fallback_total
                resolved_info = {
                    "query": query.strip(),
                    "ingredients": ingredients,
                    "matched_via": how,
                }

    if resolved_info:
        # The fallback set is small (one ingredient), so rank it in Python.
        matched_docs = [
            doc
            async for doc in db[MEDICINES_COLLECTION].find(mongo_filter)
        ]
        ranked = _rank_fallback_results(
            matched_docs,
            resolved_info["ingredients"],
            resolved_info["query"],
        )
        ranked = _sort_in_python(ranked, sort)
        start = (page - 1) * page_size
        results = [_serialize(doc) for doc in ranked[start:start + page_size]]
    else:
        cursor = (
            db[MEDICINES_COLLECTION]
            .find(mongo_filter)
            .skip((page - 1) * page_size)
            .limit(page_size)
            .sort(_mongo_sort(sort))
        )

        results = [_serialize(doc) async for doc in cursor]

    response = {
        "total": total,
        "page": page,
        "page_size": page_size,
        "results": results,
    }
    if resolved_info:
        response["resolved_from"] = resolved_info

    return response


async def get_medicine_by_id(medicine_id: str) -> dict:
    db = get_database()
    object_id = _to_object_id(medicine_id)

    medicine = await db[MEDICINES_COLLECTION].find_one({"_id": object_id})
    if not medicine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=MEDICINE_NOT_FOUND,
        )

    return _serialize(medicine)


async def get_medicine_by_pmbi_code(pmbi_code: str) -> dict:
    db = get_database()

    medicine = await db[MEDICINES_COLLECTION].find_one({"pmbi_code": pmbi_code})
    if not medicine:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=MEDICINE_NOT_FOUND,
        )

    return _serialize(medicine)


async def update_medicine(medicine_id: str, data: MedicineUpdateRequest) -> dict:
    db = get_database()
    object_id = _to_object_id(medicine_id)

    update_fields = {k: v for k, v in data.dict(exclude_unset=True).items()}
    if not update_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided to update.",
        )

    result = await db[MEDICINES_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": update_fields},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=MEDICINE_NOT_FOUND,
        )

    logger.info(f"Medicine updated: {medicine_id}")
    return {"message": "Medicine updated successfully."}


async def delete_medicine(medicine_id: str) -> dict:
    """Soft-delete a medicine (sets is_active=False)."""
    db = get_database()
    object_id = _to_object_id(medicine_id)

    result = await db[MEDICINES_COLLECTION].update_one(
        {"_id": object_id},
        {"$set": {"is_active": False}},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=MEDICINE_NOT_FOUND,
        )

    logger.info(f"Medicine deactivated: {medicine_id}")
    return {"message": "Medicine deleted successfully."}


# =====================================================
# Suggestions, filters and top savings (real catalogue data)
# =====================================================

async def suggest_medicines(query: str, limit: int = 8) -> list:
    """Autocomplete: names that start with / contain the typed text."""
    db = get_database()
    text = (query or "").strip()
    if len(text) < 2:
        return []
    safe = re.escape(text)
    docs = db[MEDICINES_COLLECTION].find(
        {
            "is_active": {"$ne": False},
            "$or": [
                {"brand_name": {"$regex": safe, "$options": "i"}},
                {"generic_name": {"$regex": safe, "$options": "i"}},
                {"composition": {"$regex": safe, "$options": "i"}},
            ],
        },
        {"brand_name": 1, "generic_name": 1, "composition": 1, "category": 1},
    ).limit(60)

    lowered = text.lower()
    rows = []
    async for doc in docs:
        name = doc.get("brand_name") or doc.get("generic_name") or ""
        starts = name.lower().startswith(lowered)
        rows.append((0 if starts else 1, name.lower(), {
            "id": str(doc["_id"]),
            "name": name,
            "generic": doc.get("composition") or doc.get("generic_name") or "",
            "category": doc.get("category") or "",
        }))
    rows.sort(key=lambda r: (r[0], r[1]))

    seen, out = set(), []
    for _, _, item in rows:
        key = item["name"].lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


async def get_filter_options() -> dict:
    """Real categories (with counts) and the price range of the catalogue."""
    db = get_database()
    counts: dict = {}
    low = high = None
    async for doc in db[MEDICINES_COLLECTION].find(
        {"is_active": {"$ne": False}}, {"category": 1, "jan_aushadhi_mrp": 1}
    ):
        cat = doc.get("category") or "Other"
        counts[cat] = counts.get(cat, 0) + 1
        price = doc.get("jan_aushadhi_mrp")
        if isinstance(price, (int, float)):
            low = price if low is None else min(low, price)
            high = price if high is None else max(high, price)
    categories = [
        {"name": name, "count": count}
        for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    return {
        "categories": categories,
        "price_min": float(low or 0),
        "price_max": float(high or 0),
    }


async def get_top_savings(limit: int = 12) -> list:
    """Medicines with the biggest saving against a real brand price."""
    db = get_database()
    cursor = (
        db[MEDICINES_COLLECTION]
        .find({"is_active": {"$ne": False}, "saving_pct": {"$gt": 0}})
        .sort([("saving_pct", -1), ("brand_name", 1)])
        .limit(max(1, min(limit, 30)))
    )
    return [_serialize(doc) async for doc in cursor]