import asyncio

import os

import re

import time

from typing import Any



import httpx

from rapidfuzz import fuzz, process

try:
    from app.brand_aliases import (
        BRAND_DEFAULT_STRENGTHS,
        BRAND_STRENGTH_MAP,
        BRAND_TO_GENERIC,
    )
except ImportError:  # running outside the app package (tests)
    from brand_aliases import (
        BRAND_DEFAULT_STRENGTHS,
        BRAND_STRENGTH_MAP,
        BRAND_TO_GENERIC,
    )





# =====================================================

# Configuration

# =====================================================



BACKEND_API_URL = os.getenv(

    "BACKEND_API_URL",

    "http://127.0.0.1:8002/api/v1",

)



MINIMUM_MATCH_SCORE = 82

MAX_CATALOG_PAGES = 30

PAGE_SIZE = 100

CATALOG_CACHE_SECONDS = 300





# =====================================================

# Prescription text filtering

# =====================================================



IGNORED_LINES = {

    "prescription",

    "medical prescription",

    "medical facility",

    "patient name",

    "doctor name",

    "full name",

    "address",

    "signature",

    "date",

    "age",

    "male",

    "female",

    "phone",

    "phone number",

    "diagnosis",

    "expiry date",

    "batch number",

    "lot number",

    "filled by",

    "form",

    "rx",

    "r",

}



IGNORED_PHRASES = {

    "prescription",

    "patient",

    "doctor",

    "signature",

    "medical facility",

    "medical practice",

    "medical centre",

    "medical center",

    "hospital",

    "full name",

    "address",

    "street",

    "phone number",

    "date",

    "expiry",

    "exp date",

    "lot no",

    "batch number",

    "filled by",

    "rank and degree",

    "edition of",

    "serial number",

    "manufacturer",

    "mfgr",

    "subscription",

    "superscription",

    "inscription",

    "signa",

    "take one",

    "take two",

    "after food",

    "before food",

    "twice daily",

    "once daily",

    "three times daily",

    "tid",

    "bid",

    "qid",

    "prn",

    "capsule daily",

    "tablet daily",

    "days",

    "cap po",

}



DOSAGE_FORM_WORDS = {

    "tablet",

    "tablets",

    "tab",

    "capsule",

    "capsules",

    "caps",

    "cap",

    "injection",

    "syrup",

    "suspension",

    "cream",

    "ointment",

    "gel",

    "drops",

    "solution",

    "powder",

    "ip",

    "bp",

    "usp",

    "prn",

    "tid",

    "bid",

    "qid",

    "po",

}



HEADER_RE = re.compile(

    r"^\s*(?:name|patient(?:\s+name)?|address|age|sex|gender|date|"

    r"physician(?:['’]s)?|lic(?:ense)?|ptr\s*no|ptrno|s2\s*no|"

    r"phone|tel|dr\b|doctor\b|hospital|clinic)\b",

    re.IGNORECASE,

)



INSTRUCTION_RE = re.compile(

    r"^\s*(?:(?:sig|sg|signa)\s*[:.]|"

    r"(?:take\s+)?(?:\d+|one|two|i)\s*"

    r"(?:cap(?:sule)?s?|tab(?:let)?s?)\b|"

    r"(?:for\s+)?(?:\d+|one|two|three|five|seven|suen)"

    r"\s+days?\b)",

    re.IGNORECASE,

)



END_RE = re.compile(

    r"^\s*[\(\[]?\s*(?:"

    r"subscription|signa|sig(?:nature)?|"

    r"physician|dr\b|doctor\b|"

    r"lic(?:ense)?\.?\s*no|ptr\s*no|ptrno|s2\s*no|"

    r"exp(?:iry)?\s*date|mfgr|manufacturer|lot\s*no|filled\s*by"

    r")\b",

    re.IGNORECASE,

)



RX_RE = re.compile(

    r"^\s*(?:r\s*x|℞|r)\b\s*[:.\-]?\s*(.*)$",

    re.IGNORECASE,

)



NON_MEDICINE_METADATA_PHRASES = {

    "mbbs",

    "consultant physician",

    "consultation by appointment",

    "consultation by appointments",

    "medicare centre",

    "medicare center",

    "court back road",

    "sunday holiday",

    "timing",

    "phone",

    "mobile",

    "mob",

    "clinic",

    "registration number",

    "reg no",

    "udupi",

}



MEDICINE_HINT_RE = re.compile(

    r"("

    r"\b\d{2,4}\s*(?:mg|mcg|g|ml|iu|units?)?\b"

    r"|"

    r"\b(?:tab(?:let)?s?|cap(?:sule)?s?|syrup|"

    r"injection|inj|cream|ointment|drops?|"

    r"solution|suspension|gel|pen|cv)\b"

    r")",

    re.IGNORECASE,

)



DATE_LIKE_RE = re.compile(

    r"^\s*\d{1,2}\s*[-/.]\s*\d{1,2}"

    r"\s*[-/.]\s*\d{2,4}\s*$"

)





# =====================================================

# Text normalization

# =====================================================



def normalize_text(value: str) -> str:

    value = value.lower().strip()

    value = re.sub(r"[^a-z0-9.+\-\s]", " ", value)

    value = re.sub(r"\s+", " ", value)

    return value.strip()





def normalize_medicine_name(value: str) -> str:

    value = value.lower().strip()



    value = re.sub(

        r"\b\d+(?:\.\d+)?\s*"

        r"(?:mg|mcg|g|ml|iu|units?|%)\b",

        " ",

        value,

    )



    value = re.sub(r"\d+", " ", value)

    value = re.sub(r"[^a-z\s]", " ", value)

    value = re.sub(r"\s+", " ", value)



    return value.strip()





def extract_strengths(value: str) -> set[str]:

    """

    Extract explicitly recognized strengths.



    Unreadable text such as 's0ong' is NOT converted to 500mg.

    """

    normalized = value.lower().replace(",", "")



    matches = re.findall(

        r"\b(\d+(?:\.\d+)?)\s*"

        r"(mcg|mg|g|ml|iu|units?|%)(?!\w)",

        normalized,

    )



    strengths: set[str] = set()



    for amount, unit in matches:

        normalized_unit = unit.lower()



        if normalized_unit in {"unit", "units"}:

            normalized_unit = "iu"



        strengths.add(f"{amount}{normalized_unit}")



    return strengths





def is_non_medicine_line(value: str) -> bool:

    text = str(value).strip()



    return bool(

        HEADER_RE.search(text)

        or INSTRUCTION_RE.search(text)

    )





def strip_rx_prefix(value: str) -> str:

    return RX_RE.sub(

        r"\1",

        str(value).strip(),

    ).strip()





def strength_review_reason(value: str) -> str:

    if not extract_strengths(value):

        return (

            "Strength could not be read reliably; "

            "confirm it from the original prescription."

        )



    return (

        "No reliable catalogue match; "

        "the text may be misread or absent from the catalogue."

    )





def should_check_line(value: str) -> bool:

    if is_non_medicine_line(value):

        return False



    normalized = normalize_text(value)



    if not normalized:

        return False



    if len(normalized) < 3 or len(normalized) > 100:

        return False



    if normalized in IGNORED_LINES:

        return False



    if normalized.isdigit():

        return False



    if not re.search(r"[a-zA-Z]", normalized):

        return False



    return True





def should_show_as_unmatched(value: str) -> bool:

    if not should_check_line(value):

        return False



    normalized = normalize_text(value)



    for phrase in IGNORED_PHRASES:

        if re.search(

            r"\b" + re.escape(phrase) + r"\b",

            normalized,

        ):

            # Do not hide an unresolved medicine just because

            # the same line ends with PRN, TID or similar text.

            if phrase not in {

                "prn",

                "tid",

                "bid",

                "qid",

                "days",

            }:

                return False



    medicine_text = normalize_medicine_name(value)

    compact_text = medicine_text.replace(" ", "")



    if len(compact_text) < 4:

        return False



    if not re.search(r"[a-zA-Z]{4,}", medicine_text):

        return False



    return True





# =====================================================

# Prescription medicine region

# =====================================================

def looks_like_fallback_medicine_line(

    value: str,

) -> bool:

    """

    Conservatively select possible medicine lines when

    PaddleOCR fails to recognize the Rx marker.



    This function intentionally prefers manual review over

    treating clinic or patient information as medicine.

    """



    original = str(value).strip()

    normalized = normalize_text(original)



    if not normalized:

        return False



    if is_non_medicine_line(original):

        return False



    if DATE_LIKE_RE.match(original):

        return False



    for phrase in NON_MEDICINE_METADATA_PHRASES:

        if phrase in normalized:

            return False



    # Remove obvious contact numbers and postal-code lines.

    digit_count = len(re.findall(r"\d", original))



    if digit_count >= 6:

        return False



    if not re.search(r"[a-zA-Z]{2,}", original):

        return False



        # A medicine clue such as tablet, capsule, pen or mg

    # provides strong evidence.

    if MEDICINE_HINT_RE.search(original):

        return True



    # PaddleOCR may merge words:

    # "Mix-30 Pen ..." -> "m1x-30Pencnendf"

    compact = re.sub(

        r"[^a-z0-9]",

        "",

        normalized,

    )



    merged_form_words = {

        "tablet",

        "tab",

        "capsule",

        "cap",

        "syrup",

        "injection",

        "inj",

        "cream",

        "drops",

        "solution",

        "pen",

    }



    if any(

        form_word in compact

        for form_word in merged_form_words

    ):

        return True



    # Conservative final fallback:

    # keep short alphanumeric handwritten lines such as

    # "Mix-30", but reject long metadata/contact lines.

    has_letters = bool(

        re.search(r"[a-zA-Z]{2,}", original)

    )

    has_digits = bool(re.search(r"\d", original))



    if (

        has_letters

        and has_digits

        and len(normalized) <= 45

        and digit_count <= 5

    ):

        return True



    return False

def _valid_box(value: Any) -> list[int] | None:

    """

    Return a normalized [left, top, right, bottom] OCR box.

    """



    if not isinstance(value, (list, tuple)) or len(value) != 4:

        return None



    try:

        left, top, right, bottom = [

            int(round(float(number)))

            for number in value

        ]

    except (TypeError, ValueError):

        return None



    if right <= left or bottom <= top:

        return None



    return [left, top, right, bottom]





def _vertical_overlap_ratio(

    first_box: list[int],

    second_box: list[int],

) -> float:

    """

    Calculate vertical overlap relative to the shorter box.

    """



    overlap_top = max(first_box[1], second_box[1])

    overlap_bottom = min(first_box[3], second_box[3])



    if overlap_bottom <= overlap_top:

        return 0.0



    first_height = first_box[3] - first_box[1]

    second_height = second_box[3] - second_box[1]

    shorter_height = min(first_height, second_height)



    if shorter_height <= 0:

        return 0.0



    return (overlap_bottom - overlap_top) / shorter_height





def _normalize_prescription_units(value: str) -> str:

    """

    Correct conservative OCR errors only when they follow a number.



    Examples:

        15 me   -> 15 ml

        120me   -> 120 ml

        500 rng -> 500 mg

    """



    text = str(value).strip()



    text = re.sub(

        r"\b(\d+(?:\.\d+)?)\s*(?:me|m1|mi)\b",

        r"\1 ml",

        text,

        flags=re.IGNORECASE,

    )



    text = re.sub(

        r"\b(\d+(?:\.\d+)?)\s*(?:rng|rn9)\b",

        r"\1 mg",

        text,

        flags=re.IGNORECASE,

    )



    text = re.sub(

        r"\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu)\b",

        r"\1 \2",

        text,

        flags=re.IGNORECASE,

    )



    text = re.sub(r"\s+", " ", text)



    return text.strip()





def merge_spatial_ocr_fragments(

    ocr_lines: list[dict[str, Any]],

) -> list[dict[str, Any]]:

    """

    Merge OCR fragments located on the same visual row.



    Example:

        Tr Belladonna  +  15  +  me

        becomes:

        Tr Belladonna 15 ml

    """



    boxed_items: list[dict[str, Any]] = []

    unboxed_items: list[dict[str, Any]] = []



    for original_item in ocr_lines:

        text = str(original_item.get("text", "")).strip()



        if not text:

            continue



        item = dict(original_item)

        item["text"] = text

        item["box"] = _valid_box(item.get("box"))



        if item["box"] is None:

            unboxed_items.append(item)

        else:

            boxed_items.append(item)



    boxed_items.sort(

        key=lambda item: (

            item["box"][1],

            item["box"][0],

        )

    )



    row_groups: list[list[dict[str, Any]]] = []



    for item in boxed_items:

        item_box = item["box"]

        best_group: list[dict[str, Any]] | None = None

        best_overlap = 0.0



        for group in row_groups:

            group_top = min(

                member["box"][1]

                for member in group

            )

            group_bottom = max(

                member["box"][3]

                for member in group

            )



            group_box = [

                min(member["box"][0] for member in group),

                group_top,

                max(member["box"][2] for member in group),

                group_bottom,

            ]



            overlap = _vertical_overlap_ratio(

                item_box,

                group_box,

            )



            if overlap >= 0.55 and overlap > best_overlap:

                best_group = group

                best_overlap = overlap



        if best_group is None:

            row_groups.append([item])

        else:

            best_group.append(item)



    merged_items: list[dict[str, Any]] = []



    for group in row_groups:

        group.sort(key=lambda item: item["box"][0])



        texts = [

            str(item.get("text", "")).strip()

            for item in group

            if str(item.get("text", "")).strip()

        ]



        confidences = [

            float(item.get("confidence", 0) or 0)

            for item in group

        ]



        merged_box = [

            min(item["box"][0] for item in group),

            min(item["box"][1] for item in group),

            max(item["box"][2] for item in group),

            max(item["box"][3] for item in group),

        ]



        merged_text = _normalize_prescription_units(

            " ".join(texts)

        )



        merged_items.append(

            {

                **group[0],

                "text": merged_text,

                "source_ocr_text": " | ".join(texts),

                "confidence": round(

                    sum(confidences) / len(confidences),

                    4,

                ) if confidences else 0.0,

                "box": merged_box,

                "merged_fragment_count": len(group),

            }

        )



    merged_items.extend(unboxed_items)



    merged_items.sort(

        key=lambda item: (

            (

                item.get("box", [0, 10**9, 0, 0])[1]

                if item.get("box")

                else 10**9

            ),

            (

                item.get("box", [10**9, 0, 0, 0])[0]

                if item.get("box")

                else 10**9

            ),

        )

    )



    return merged_items

def get_medication_region(

    ocr_lines: list[dict[str, Any]],

) -> list[dict[str, Any]]:

    """

    Locate likely medicine lines.



    When Rx is detected, use the text between Rx and the

    doctor/signature section.



    When Rx is not detected, use a conservative medicine-line

    classifier so headers, addresses and footers are excluded.

    """



    start_index: int | None = None

    first_line: dict[str, Any] | None = None



    for index, item in enumerate(ocr_lines):

        text = str(item.get("text", "")).strip()

        normalized = normalize_text(text)

        rx_match = RX_RE.match(text)



        marker_found = bool(rx_match) or normalized in {

            "rx",

            "r x",

            "r",

            "℞",

        }



        # PaddleOCR sometimes reads Rx as Px.

        if normalized == "px":

            following_items = ocr_lines[

                index + 1:index + 5

            ]



            marker_found = any(

                looks_like_fallback_medicine_line(

                    str(following.get("text", ""))

                )

                for following in following_items

            )



        if not marker_found:

            continue



        start_index = index + 1



        if rx_match:

            remainder = rx_match.group(1).strip()



            if remainder:

                first_line = {

                    **item,

                    "text": remainder,

                    "source_ocr_text": text,

                }



        break



    # Rx was not recognized. Do not return every OCR line.

    if start_index is None:

        return [

            item

            for item in ocr_lines

            if looks_like_fallback_medicine_line(

                str(item.get("text", ""))

            )

        ]



    medication_lines: list[dict[str, Any]] = []



    if (

        first_line is not None

        and should_check_line(

            str(first_line.get("text", ""))

        )

    ):

        medication_lines.append(first_line)



    for item in ocr_lines[start_index:]:

        text = str(item.get("text", "")).strip()

        normalized = normalize_text(text)



        if END_RE.search(text):

            break



        if normalized in {

            "px",

            "rx",

            "r",

            "r x",

        }:

            continue



        if is_non_medicine_line(text):

            continue



        # Keep every fragment inside the medication region, including
        # numeric-only strength fragments such as "15". They are filtered
        # after spatial row merging, otherwise "Tr Belladonna" cannot be
        # reconstructed as "Tr Belladonna 15 ml".
        if text:
            medication_lines.append(item)



    return medication_lines





# =====================================================

# Catalogue loading and caching

# =====================================================



_catalog_cache: list[dict[str, Any]] = []

_catalog_loaded_at = 0.0

_catalog_lock = asyncio.Lock()





async def _fetch_medicine_catalog() -> list[dict[str, Any]]:

    medicines: list[dict[str, Any]] = []

    page = 1

    total = 0



    async with httpx.AsyncClient(timeout=30.0) as client:

        while page <= MAX_CATALOG_PAGES:

            response = await client.get(

                f"{BACKEND_API_URL}/medicines",

                params={

                    "page": page,

                    "page_size": PAGE_SIZE,

                },

            )



            response.raise_for_status()

            data = response.json()



            page_results = data.get("results", [])



            if not isinstance(page_results, list):

                break



            if not page_results:

                break



            medicines.extend(page_results)



            total = int(

                data.get("total", len(medicines))

            )



            if len(medicines) >= total:

                break



            page += 1



    if not medicines:

        raise ValueError(

            "The medicine catalogue is empty."

        )



    if len(medicines) < total:

        raise ValueError(

            "Catalogue pagination limit reached; "

            "not all records were loaded."

        )



    return medicines





async def load_medicine_catalog() -> list[dict[str, Any]]:

    global _catalog_cache

    global _catalog_loaded_at



    async with _catalog_lock:

        if (

            _catalog_cache

            and time.monotonic() - _catalog_loaded_at

            < CATALOG_CACHE_SECONDS

        ):

            return _catalog_cache



        catalogue = await _fetch_medicine_catalog()



        _catalog_cache = catalogue

        _catalog_loaded_at = time.monotonic()



        return catalogue





# =====================================================

# Searchable medicine names

# =====================================================



def medicine_search_values(

    medicine: dict[str, Any],

) -> list[str]:

    fields = [

        medicine.get("brand_name"),

        medicine.get("generic_name"),

        medicine.get("composition"),

    ]



    aliases = medicine.get("aliases", [])



    if isinstance(aliases, list):

        fields.extend(aliases)



    normalized_values: list[str] = []



    for field in fields:

        if not field:

            continue



        normalized = normalize_medicine_name(

            str(field)

        )



        if not normalized:

            continue



        if normalized not in normalized_values:

            normalized_values.append(normalized)



    return normalized_values





# =====================================================

# Ingredient normalization and comparison

# =====================================================



def extract_ingredient_name(value: str) -> str:

    """

    Normalize known spelling variants before comparison.



    This does not hard-code OCR mistakes as valid names.

    The original OCR text remains unchanged in the response.

    """

    normalized = normalize_medicine_name(value)



    remaining_words = [

        word

        for word in normalized.split()

        if word not in DOSAGE_FORM_WORDS

    ]



    spelling_variants = {

        "amoxycillin": "amoxicillin",

    }



    return " ".join(

        spelling_variants.get(word, word)

        for word in remaining_words

    ).strip()





def split_composition_ingredients(

    composition: str,

) -> list[str]:

    if not composition:

        return []



    parts = re.split(

        r"\s*(?:\+|&|/|\band\b|\bwith\b)\s*",

        composition,

        flags=re.IGNORECASE,

    )



    ingredients: list[str] = []



    for part in parts:

        ingredient = extract_ingredient_name(part)



        if ingredient and ingredient not in ingredients:

            ingredients.append(ingredient)



    return ingredients





# =====================================================

# Candidate scoring

# =====================================================



def _legacy_match_score(

    ocr_line: str,

    medicine: dict[str, Any],

) -> float:

    normalized_line = normalize_medicine_name(

        ocr_line

    )



    if not normalized_line:

        return 0.0



    searchable_values = medicine_search_values(

        medicine

    )



    if not searchable_values:

        return 0.0



    line_words = normalized_line.split()

    line_compact = normalized_line.replace(" ", "")



    scores: list[float] = []



    for medicine_name in searchable_values:

        medicine_compact = medicine_name.replace(

            " ",

            "",

        )



        if not medicine_compact:

            continue



        if len(medicine_compact) < 5:

            if medicine_name in line_words:

                scores.append(100.0)

            continue



        if medicine_name in normalized_line:

            scores.append(100.0)

            continue



        direct_score = fuzz.ratio(

            normalized_line,

            medicine_name,

        )

        scores.append(float(direct_score))



        shortest_length = min(

            len(line_compact),

            len(medicine_compact),

        )

        longest_length = max(

            len(line_compact),

            len(medicine_compact),

        )



        length_ratio = (

            shortest_length / longest_length

            if longest_length

            else 0

        )



        if length_ratio >= 0.60:

            partial_score = fuzz.partial_ratio(

                medicine_name,

                normalized_line,

            )

            scores.append(float(partial_score))



    if not scores:

        return 0.0



    final_score = max(scores)

    ocr_strengths = extract_strengths(ocr_line)



    medicine_strengths: set[str] = set()



    for field_name in (

        "brand_name",

        "generic_name",

        "composition",

    ):

        field_value = medicine.get(field_name)



        if field_value:

            medicine_strengths.update(

                extract_strengths(str(field_value))

            )



    if ocr_strengths and medicine_strengths:

        if ocr_strengths.intersection(

            medicine_strengths

        ):

            final_score += 5

        else:

            final_score -= 35



    return round(

        max(0.0, min(100.0, final_score)),

        2,

    )





# =====================================================
# Ingredient-level matching (v2)
#
# The first version compared the OCR line with whole catalogue
# names ("Metformin Hydrochloride Tablets IP 500mg"). Salts, dosage
# forms and brand names therefore lowered the score or blocked the
# match, and look-alike drugs (azithromycin / clarithromycin) could
# slip through a fuzzy threshold.
#
# v2 first resolves the OCR text to a SET OF INGREDIENTS, then looks
# for catalogue medicines with exactly that set, and only then uses
# strength / form to rank them. Anything ambiguous is NOT guessed -
# it stays in the "needs manual review" list.
# =====================================================

SALT_WORDS = {
    "hydrochloride", "dihydrochloride", "hcl", "hydrobromide",
    "sodium", "potassium", "calcium", "magnesium",
    "maleate", "besylate", "besilate", "tartrate", "bitartrate",
    "succinate", "sulphate", "sulfate", "phosphate", "acetate",
    "citrate", "mesylate", "fumarate", "bromide", "nitrate",
    "mononitrate", "dinitrate", "trihydrate", "dihydrate",
    "anhydrous", "hemihydrate", "monohydrate", "medoxomil",
    "axetil", "proxetil", "pivoxil",
}

RELEASE_WORDS = {
    "sr", "xr", "er", "xl", "cr", "retard", "sustained",
    "prolonged", "extended", "modified", "controlled", "delayed",
}

NOISE_WORDS = DOSAGE_FORM_WORDS | {
    "tabs", "inj", "syp", "susp", "oint", "lotion", "sachet",
    "strip", "strips", "drop", "oral", "dry", "eye", "ear", "nasal",
    "per", "w", "v", "film", "coated", "chewable", "dispersible",
    "enteric", "gastro", "resistant", "resistance", "release",
    "orally", "disintegrating", "od", "bd", "tds", "sos", "hs",
    "daily", "once", "twice", "days", "day", "after", "before",
    "food", "meal", "meals", "morning", "night", "for", "x", "ml",
}

# Words that should be treated as spelling variants of one ingredient.
INGREDIENT_SYNONYMS = {
    "amoxycillin": "amoxicillin",
    "acetaminophen": "paracetamol",
    "clavulanate": "clavulanic acid",
    "cefalexin": "cephalexin",
    "frusemide": "furosemide",
    "albuterol": "salbutamol",
}

FORM_GROUPS = {
    "tablet": {"tablet", "tablets", "tab", "tabs"},
    "capsule": {"capsule", "capsules", "cap", "caps"},
    "liquid": {"syrup", "syp", "suspension", "susp", "solution", "drops"},
    "injection": {"injection", "inj"},
    "topical": {"cream", "ointment", "oint", "gel", "lotion"},
}

# When several catalogue entries tie, prefer oral solids.
FORM_RANK = {"tablet": 0, "capsule": 0, "liquid": 1, "injection": 2, "topical": 3}

# An ingredient must be at least this similar to a catalogue ingredient,
# AND clearly better than the runner-up, otherwise it is left for review.
INGREDIENT_MATCH_MIN = 88
INGREDIENT_MARGIN = 5
BRAND_FUZZY_MIN = 90

# Repair obvious letter/digit confusions INSIDE a strength token only
# ("1Omg" -> "10mg", "5OOmg" -> "500mg"). Candidates built from a
# repaired strength carry a note asking for extra confirmation.
# Set to False to keep the older strict behaviour.
REPAIR_DIGIT_CONFUSIONS = True
_CONFUSABLE = {"O": "0", "o": "0", "l": "1", "I": "1"}
_STRENGTH_TOKEN_RE = re.compile(
    r"\b([0-9OolI][0-9OolI.]{0,5})\s*(?:mcg|mg|g|ml|iu)\b"
)
_PART_SPLIT_RE = re.compile(
    r"\s*(?:\+|&|/|,|;|\band\b|\bwith\b)\s*",
    re.IGNORECASE,
)
_NUMBERING_RE = re.compile(r"^\s*\d+\s*[\).:\-]\s*")


def _repair_strength_text(text: str) -> tuple[str, bool]:
    if not REPAIR_DIGIT_CONFUSIONS:
        return text, False

    changed = False

    def fix(match: re.Match) -> str:
        nonlocal changed
        token = match.group(1)
        if not re.search(r"\d", token) or not re.search(r"[OolI]", token):
            return match.group(0)
        changed = True
        fixed = "".join(_CONFUSABLE.get(ch, ch) for ch in token)
        return fixed + match.group(0)[len(token):]

    return _STRENGTH_TOKEN_RE.sub(fix, text), changed


def canonical_ingredient(part: str) -> str:
    """Reduce 'Metformin Hydrochloride Tablets IP 500mg' to 'metformin'."""
    words = normalize_medicine_name(part).split()
    kept = [
        word for word in words
        if word not in NOISE_WORDS and word not in RELEASE_WORDS
    ]
    without_salts = [word for word in kept if word not in SALT_WORDS] or kept
    mapped = [INGREDIENT_SYNONYMS.get(word, word) for word in without_salts]
    return " ".join(mapped).strip()


def ingredient_parts(text: str) -> list[str]:
    parts: list[str] = []
    for raw in _PART_SPLIT_RE.split(str(text)):
        canonical = canonical_ingredient(raw)
        if len(canonical) < 3:
            continue
        if canonical not in parts:
            parts.append(canonical)
    return parts


_MED_ING_CACHE: dict[tuple, frozenset] = {}


def medicine_ingredient_set(medicine: dict[str, Any]) -> frozenset:
    key = (
        medicine.get("id"),
        medicine.get("pmbi_code"),
        medicine.get("composition"),
        medicine.get("generic_name"),
    )
    cached = _MED_ING_CACHE.get(key)
    if cached is not None:
        return cached
    source = (
        str(medicine.get("composition") or "").strip()
        or str(medicine.get("generic_name") or "")
    )
    result = frozenset(ingredient_parts(source))
    if not result:
        result = frozenset(
            ingredient_parts(str(medicine.get("generic_name") or ""))
        )
    _MED_ING_CACHE[key] = result
    return result


def _brand_key(brand: str) -> str:
    words = [
        word for word in normalize_medicine_name(brand).split()
        if word not in DOSAGE_FORM_WORDS
    ]
    return " ".join(words)


class _CatalogIndex:
    """Lookup tables derived once per loaded catalogue."""

    def __init__(self, medicines: list[dict[str, Any]]) -> None:
        self.by_ingredients: dict[frozenset, list[dict[str, Any]]] = {}
        vocabulary: set[str] = set()
        brand_sets: dict[str, set[frozenset]] = {}

        for medicine in medicines:
            ingredients = medicine_ingredient_set(medicine)
            if not ingredients:
                continue
            self.by_ingredients.setdefault(ingredients, []).append(medicine)
            vocabulary.update(ingredients)

            brand = str(medicine.get("brand_name") or "").strip()
            generic = str(medicine.get("generic_name") or "").strip()
            if brand and brand.lower() != generic.lower():
                key = _brand_key(brand)
                if key:
                    brand_sets.setdefault(key, set()).add(ingredients)

        self.vocab_set = vocabulary
        self.vocab = sorted(vocabulary)

        self.brands: dict[str, frozenset] = {
            key: next(iter(sets))
            for key, sets in brand_sets.items()
            if len(sets) == 1
        }

        # "Voveran SR 50" in the catalogue should also answer to "Voveran".
        first_word_sets: dict[str, set[frozenset]] = {}
        for key, sets in brand_sets.items():
            first = key.split()[0]
            if first not in self.brands:
                first_word_sets.setdefault(first, set()).update(sets)
        for first, sets in first_word_sets.items():
            if len(sets) == 1:
                self.brands.setdefault(first, next(iter(sets)))

        # Curated brands (catalogue brands win on conflict).
        for key, ingredients in BRAND_TO_GENERIC.items():
            self.brands.setdefault(key, frozenset(ingredients))

        self.brand_keys = sorted(self.brands)


_INDEX_CACHE: dict[str, Any] = {"key": None, "index": None}


def _get_index(medicines: list[dict[str, Any]]) -> _CatalogIndex:
    key = (id(medicines), len(medicines))
    if _INDEX_CACHE["key"] != key:
        _INDEX_CACHE["index"] = _CatalogIndex(medicines)
        _INDEX_CACHE["key"] = key
    return _INDEX_CACHE["index"]


def _name_variants(name: str) -> set[str]:
    variants = {
        name,
        name.replace("rn", "m"),
        name.replace("vv", "w"),
        name.replace(" ", ""),
    }
    return {variant for variant in variants if variant}


def _resolve_single(
    attempt: str,
    index: _CatalogIndex,
) -> tuple[str, float] | None:
    if attempt in index.vocab_set:
        return attempt, 100.0

    variants = _name_variants(attempt)
    for variant in variants:
        if variant != attempt and variant in index.vocab_set:
            return variant, 95.0

    scored: dict[str, float] = {}
    for variant in variants:
        for term, score, _ in process.extract(
            variant,
            index.vocab,
            scorer=fuzz.ratio,
            limit=3,
        ):
            if score > scored.get(term, 0.0):
                scored[term] = float(score)

    ranked = sorted(scored.items(), key=lambda item: item[1], reverse=True)
    if not ranked:
        return None

    top_term, top_score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0

    # Look-alike guard: a fuzzy hit must clearly beat the next-best drug.
    if top_score >= INGREDIENT_MATCH_MIN and top_score - runner_up >= INGREDIENT_MARGIN:
        return top_term, top_score
    return None


def _resolve_ingredient(
    name: str,
    index: _CatalogIndex,
) -> tuple[str, float] | None:
    words = name.split()
    attempts = [name]
    if len(words) > 1:
        for size in range(min(3, len(words)), 0, -1):
            for start in range(0, len(words) - size + 1):
                window = " ".join(words[start:start + size])
                if window not in attempts:
                    attempts.append(window)

    for attempt in attempts:
        if len(attempt) < 4:
            continue
        result = _resolve_single(attempt, index)
        if result:
            return result
    return None


def _resolve_brand_fuzzy(
    token: str,
    index: _CatalogIndex,
) -> str | None:
    if len(token) < 5:
        return None
    ranked = process.extract(
        token,
        index.brand_keys,
        scorer=fuzz.ratio,
        limit=2,
    )
    if not ranked:
        return None
    top_key, top_score, _ = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    if top_score >= BRAND_FUZZY_MIN and top_score - runner_up >= INGREDIENT_MARGIN:
        return top_key
    return None


def _infer_brand_strengths(
    brand_key: str,
    cleaned: str,
    ingredient_count: int,
) -> set[str]:
    # Only the number(s) written right after the brand are strengths;
    # later numbers are usually "1 tab", "x 7 days", "10 tablets".
    numbers = re.findall(r"(?<![\w.])(\d{1,4})(?![\w.])", cleaned)
    numbers = numbers[: max(1, ingredient_count)]

    code_map = BRAND_STRENGTH_MAP.get(brand_key, {})
    for number in numbers:
        if number in code_map:
            return set(code_map[number])

    if numbers:
        return {f"{number}mg" for number in numbers}

    return set(BRAND_DEFAULT_STRENGTHS.get(brand_key, ()))


def _resolve_line(text: str, index: _CatalogIndex) -> dict[str, Any] | None:
    cleaned = _NUMBERING_RE.sub("", strip_rx_prefix(text))
    explicit_strengths = extract_strengths(cleaned)

    tokens = re.findall(r"[a-z]+", cleaned.lower())
    while tokens and (tokens[0] in NOISE_WORDS or tokens[0] == "rx"):
        tokens.pop(0)

    notes: list[str] = []
    brand_key: str | None = None
    ingredients: frozenset | None = None
    similarity = 100.0
    via = "generic_name"

    # 1) exact brand at the start of the line
    if tokens:
        candidates = []
        if len(tokens) >= 2:
            candidates.append(f"{tokens[0]} {tokens[1]}")
        candidates.append(tokens[0])
        for candidate in candidates:
            if candidate in index.brands:
                brand_key = candidate
                break

    if brand_key:
        ingredients = index.brands[brand_key]
        via = "brand_name"
    else:
        # 2) ingredient names
        parts = ingredient_parts(cleaned)
        if not parts:
            return None

        resolved: list[str] = []
        similarities: list[float] = []
        for part in parts:
            result = _resolve_ingredient(part, index)
            if result is None:
                resolved = []
                break
            resolved.append(result[0])
            similarities.append(result[1])

        if resolved:
            ingredients = frozenset(resolved)
            similarity = sum(similarities) / len(similarities)
            if similarity < 100.0:
                via = "spelling_correction"
        elif len(parts) == 1 and tokens:
            # 3) near-miss brand spelling
            fuzzy_brand = _resolve_brand_fuzzy(tokens[0], index)
            if fuzzy_brand:
                brand_key = fuzzy_brand
                ingredients = index.brands[fuzzy_brand]
                via = "brand_name"
                similarity = 92.0

    if not ingredients:
        return None

    strengths = set(explicit_strengths)
    strengths_inferred = False
    if not strengths and brand_key:
        strengths = _infer_brand_strengths(brand_key, cleaned, len(ingredients))
        strengths_inferred = bool(strengths)
        if strengths_inferred:
            notes.append(
                "Strength was inferred from the brand name "
                f"({', '.join(sorted(strengths))}); confirm it on the prescription."
            )

    if brand_key:
        notes.append(
            f"Prescription names the brand '{brand_key.title()}'; "
            "the Jan Aushadhi generic with the same ingredient(s) is suggested."
        )

    return {
        "ingredients": ingredients,
        "similarity": similarity,
        "via": via,
        "brand": brand_key,
        "strengths": strengths,
        "strengths_inferred": strengths_inferred,
        "notes": notes,
    }


# ---------- strength / form helpers ----------

_UNIT_SCALE = {
    "mg": ("mass", 1.0),
    "g": ("mass", 1000.0),
    "mcg": ("mass", 0.001),
    "ml": ("volume", 1.0),
    "iu": ("iu", 1.0),
    "%": ("percent", 1.0),
}


def _strength_values(strengths: set[str]) -> set[tuple[str, float]]:
    values: set[tuple[str, float]] = set()
    for strength in strengths:
        match = re.fullmatch(r"(\d+(?:\.\d+)?)(mcg|mg|g|ml|iu|%)", strength)
        if not match:
            continue
        unit_class, scale = _UNIT_SCALE[match.group(2)]
        values.add((unit_class, round(float(match.group(1)) * scale, 6)))
    return values


def _medicine_strengths(medicine: dict[str, Any]) -> set[str]:
    strengths: set[str] = set()
    for field_name in ("brand_name", "generic_name", "composition"):
        value = medicine.get(field_name)
        if value:
            strengths.update(extract_strengths(str(value)))
    return strengths


def _strength_adjustment(
    ocr_strengths: set[str],
    medicine_strengths: set[str],
) -> int:
    ocr_values = _strength_values(ocr_strengths)
    medicine_values = _strength_values(medicine_strengths)
    if not ocr_values or not medicine_values:
        return 0
    if ocr_values <= medicine_values:
        return 5
    if ocr_values & medicine_values:
        return -20
    return -35


def _forms_in(text: str) -> set[str]:
    tokens = set(re.findall(r"[a-z]+", str(text).lower()))
    return {
        group for group, words in FORM_GROUPS.items() if tokens & words
    }


def _has_release_modifier(text: str) -> bool:
    return bool(set(re.findall(r"[a-z]+", str(text).lower())) & RELEASE_WORDS)


def _form_and_release_adjustment(ocr_text: str, medicine: dict[str, Any]) -> int:
    delta = 0
    ocr_forms = _forms_in(ocr_text)
    medicine_forms = _forms_in(medicine.get("generic_name", ""))
    if ocr_forms and medicine_forms and not (ocr_forms & medicine_forms):
        delta -= 15
    if _has_release_modifier(ocr_text) != _has_release_modifier(
        medicine.get("generic_name", "")
    ):
        delta -= 8
    return delta


def _form_rank(medicine: dict[str, Any]) -> int:
    forms = _forms_in(medicine.get("generic_name", ""))
    return min((FORM_RANK[form] for form in forms), default=1)


def composition_matches_ocr(
    ocr_line: str,
    medicine: dict[str, Any],
) -> bool:
    """
    Ingredient-set check kept for backwards compatibility.
    True when the OCR text names exactly the medicine's ingredients.
    """
    parts = ingredient_parts(strip_rx_prefix(ocr_line))
    ingredients = medicine_ingredient_set(medicine)
    if not parts or len(parts) != len(ingredients):
        return False
    return all(
        max(
            fuzz.ratio(variant, ingredient)
            for variant in _name_variants(part)
        ) >= INGREDIENT_MATCH_MIN
        for part in parts
        for ingredient in [max(
            ingredients,
            key=lambda item, p=part: fuzz.ratio(p, item),
        )]
    )


# =====================================================
# Candidate scoring (public name kept: handwriting_fallback uses it)
# =====================================================

def calculate_match_score(
    ocr_line: str,
    medicine: dict[str, Any],
) -> float:
    legacy_score = _legacy_match_score(ocr_line, medicine)

    parts = ingredient_parts(strip_rx_prefix(ocr_line))
    ingredients = medicine_ingredient_set(medicine)
    if not parts or not ingredients:
        return legacy_score

    similarities = [
        max(
            fuzz.ratio(variant, ingredient)
            for variant in _name_variants(part)
            for ingredient in ingredients
        )
        for part in parts
    ]
    score = sum(similarities) / len(similarities)
    score -= 20 * abs(len(parts) - len(ingredients))
    score += _strength_adjustment(
        extract_strengths(ocr_line),
        _medicine_strengths(medicine),
    )
    score += _form_and_release_adjustment(ocr_line, medicine)

    return max(legacy_score, round(max(0.0, min(100.0, score)), 2))


def _score_candidate(
    resolution: dict[str, Any],
    medicine: dict[str, Any],
    ocr_text: str,
) -> float:
    score = float(resolution["similarity"])
    score += _strength_adjustment(
        resolution["strengths"],
        _medicine_strengths(medicine),
    )
    score += _form_and_release_adjustment(ocr_text, medicine)
    return round(max(0.0, min(100.0, score)), 2)


# =====================================================
# Find medicine candidates
# =====================================================

def find_matches(
    ocr_lines: list[dict[str, Any]],
    medicines: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    index = _get_index(medicines)
    matched_lines: list[dict[str, Any]] = []

    for ocr_item in ocr_lines:
        original_text = str(ocr_item.get("text", "")).strip()

        if not should_check_line(original_text):
            continue

        search_text, strength_repaired = _repair_strength_text(original_text)

        resolution = _resolve_line(search_text, index)
        if resolution is None:
            continue

        # Missing/unreadable strengths remain under manual review.
        if not resolution["strengths"]:
            continue

        notes = list(resolution["notes"])
        if strength_repaired:
            notes.append(
                "A strength looked misread (letter instead of digit) "
                "and was corrected; check it against the original prescription."
            )

        scored: list[tuple[float, int, dict[str, Any]]] = []
        for medicine in index.by_ingredients.get(resolution["ingredients"], []):
            score = _score_candidate(resolution, medicine, search_text)
            if score < MINIMUM_MATCH_SCORE:
                continue
            scored.append((score, _form_rank(medicine), medicine))

        scored.sort(key=lambda item: (-item[0], item[1]))

        # No dosage form written on the prescription: if an oral
        # tablet/capsule matches, do not clutter the list with
        # injections or topical products of the same drug.
        if not _forms_in(search_text) and any(
            rank == 0 for _, rank, _ in scored
        ):
            scored = [item for item in scored if item[1] < 2]

        unique_candidates: list[dict[str, Any]] = []
        seen_medicines: set[str] = set()
        for score, _, medicine in scored:
            identifier = str(
                medicine.get("id")
                or medicine.get("pmbi_code")
                or medicine.get("generic_name")
                or ""
            )
            if not identifier or identifier in seen_medicines:
                continue
            seen_medicines.add(identifier)
            unique_candidates.append(
                {
                    "medicine_id": medicine.get("id"),
                    "pmbi_code": medicine.get("pmbi_code"),
                    "brand_name": medicine.get("brand_name"),
                    "generic_name": medicine.get("generic_name"),
                    "composition": medicine.get("composition"),
                    "jan_aushadhi_mrp": medicine.get("jan_aushadhi_mrp"),
                    "branded_avg_mrp": medicine.get("branded_avg_mrp"),
                    "saving_pct": medicine.get("saving_pct"),
                    "match_score": score,
                    "matched_via": resolution["via"],
                }
            )
            if len(unique_candidates) == 3:
                break

        if unique_candidates:
            matched_lines.append(
                {
                    "ocr_text": original_text,
                    "ocr_confidence": ocr_item.get("confidence", 0),
                    "requires_confirmation": True,
                    "resolved_ingredients": sorted(resolution["ingredients"]),
                    "notes": notes,
                    "candidates": unique_candidates,
                }
            )

    return matched_lines


# =====================================================

# Main OCR matching entry point

# =====================================================



async def match_ocr_medicines(

    ocr_lines: list[dict[str, Any]],

) -> dict[str, Any]:

    try:

        medicines = await load_medicine_catalog()



        raw_medication_region = get_medication_region(
            ocr_lines
        )



        medication_region = merge_spatial_ocr_fragments(
            raw_medication_region
        )



        matches = find_matches(

            ocr_lines=medication_region,

            medicines=medicines,

        )



        matched_texts = {

            normalize_text(match.get("ocr_text", ""))

            for match in matches

        }



        unmatched_lines: list[dict[str, Any]] = []



        for ocr_item in medication_region:

            original_text = str(

                ocr_item.get("text", "")

            ).strip()



            normalized_text = normalize_text(

                original_text

            )



            if normalized_text in matched_texts:

                continue



            if not should_show_as_unmatched(

                original_text

            ):

                continue



            unmatched_lines.append(

                {

                    "ocr_text": original_text,

                    "ocr_confidence": ocr_item.get(

                        "confidence",

                        0,

                    ),

                    "source_ocr_text": ocr_item.get(

                        "source_ocr_text",

                        original_text,

                    ),

                    "box": ocr_item.get("box"),

                    "status": (

                        "strength_unclear"

                        if not extract_strengths(original_text)

                        else "no_reliable_match"

                    ),

                    "reason": strength_review_reason(

                        original_text

                    ),

                    "requires_manual_review": True,

                }

            )



        return {

            "catalog_available": True,

            "catalog_count": len(medicines),

            "matched_line_count": len(matches),

            "matches": matches,

            "unmatched_line_count": len(unmatched_lines),

            "unmatched_lines": unmatched_lines,

            "warning": (

                "OCR candidates are suggestions only. "

                "The customer, doctor or pharmacist "

                "must confirm every medicine."

            ),

        }



    except httpx.HTTPError as error:

        return {

            "catalog_available": False,

            "catalog_count": 0,

            "matched_line_count": 0,

            "matches": [],

            "unmatched_line_count": 0,

            "unmatched_lines": [],

            "warning": (

                "OCR completed, but the medicine "

                "backend could not be reached: "

                f"{str(error)}"

            ),

        }



    except Exception as error:

        return {

            "catalog_available": False,

            "catalog_count": 0,

            "matched_line_count": 0,

            "matches": [],

            "unmatched_line_count": 0,

            "unmatched_lines": [],

            "warning": (

                "Medicine matching failed: "

                f"{str(error)}"

            ),

        }