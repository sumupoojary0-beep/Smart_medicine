"""
Match the item names printed on a supplier bill to the Jan Aushadhi catalogue
(the "Match" step of the stock-import ETL).

Pure Python - give it the list of catalogue documents and it returns the best
candidates with a 0..1 score.  Supplier bills usually print BRAND names
("CLOPIGOLD A 150(CLOPI 75 & ASPRN 15)"), while the catalogue holds generic
names ("Clopidogrel 75mg and Aspirin 150mg Capsules IP"), so the matcher works
on the active ingredients and strengths, not on the brand spelling:

    1.  a PMBI code printed in brackets, e.g. "ATORVASTATIN 40MG TAB (456)",
        is trusted when the medicine it points to agrees with the name
    2.  the bracket text / name is turned into ingredient tokens
        (abbreviations like CLOPI, ASPRN, GLIME are understood)
    3.  each catalogue medicine is scored on
          - how many of the printed ingredients it contains
          - how many of ITS ingredients the bill mentions (so a single drug
            does not match a 3-drug combination)
          - whether the strengths agree
          - extended-release / pack-size agreement
"""

from __future__ import annotations

import difflib
import re
from typing import Any, Optional

try:  # shipped with the backend since the brand->generic search fix
    from app.utils.brand_aliases import BRAND_TO_GENERIC
except Exception:  # pragma: no cover - keeps this module usable on its own
    BRAND_TO_GENERIC = {}


# words that are not ingredients
NOISE = set("""
tablet tablets tab tabs capsule capsules cap caps syrup suspension injection inj oral solution cream gel ointment
drops drop powder sachet lotion spray inhaler respules eye ear nasal
ip bp usp bppi pmbi
extended release prolonged sustained modified delayed gastro resistant enteric coated film dispersible chewable
mouth dissolving soluble
and with plus forte
hydrochloride hcl succinate tartrate besilate besylate maleate sodium potassium calcium sulphate sulfate phosphate
acetate citrate mesylate fumarate bromide chloride hydrobromide dihydrate anhydrous monohydrate
mg mcg gm gms ml iu
""".split())

RELEASE_WORDS = {"extended", "prolonged", "sustained", "modified", "release", "retard"}
RELEASE_SUFFIX = re.compile(r"(?<![A-Z])(XL|ER|SR|CR|XR|PR|MR)(?![A-Z])")


FORM_PATTERNS = {
    "tablet": r"\b(tab|tabs|tablet|tablets)\b",
    "capsule": r"\b(cap|caps|capsule|capsules)\b",
    "injection": r"\b(inj|injection|injections)\b",
    "liquid": r"\b(syp|syrup|susp|suspension|solution|elixir|liquid)\b",
    "topical": r"\b(cream|gel|ointment|lotion)\b",
    "drops": r"\b(drop|drops)\b",
    "powder": r"\b(powder|sachet)\b",
}


def forms_in(text: str) -> set:
    lowered = (text or "").lower()
    return {name for name, pattern in FORM_PATTERNS.items() if re.search(pattern, lowered)}


def _alpha_tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z]{3,}", text.lower()) if t not in NOISE]


def _numbers(text: str) -> list[float]:
    return [float(n) for n in re.findall(r"(?<![\w.])\d+(?:\.\d+)?", text)]


def _is_subsequence(small: str, big: str) -> bool:
    it = iter(big)
    return all(ch in it for ch in small)


def token_vs_word(token: str, word: str) -> float:
    """How well does a printed token (maybe an abbreviation / typo) fit an ingredient word?"""
    if token == word:
        return 1.0
    if len(token) >= 3 and word.startswith(token):
        return 1.0
    if len(word) >= 4 and token.startswith(word):
        return 1.0
    if len(token) >= 4 and token[:2] == word[:2] and _is_subsequence(token, word):
        return 0.9
    if token[:1] == word[:1] and abs(len(token) - len(word)) <= 3 and len(token) >= 5:
        if difflib.SequenceMatcher(None, token, word).ratio() >= 0.85:
            return 0.85
    return 0.0


class CatalogueIndex:
    """Pre-computed ingredient words / strengths for every catalogue medicine."""

    def __init__(self, medicines: list[dict]):
        self.entries: list[dict] = []
        self.by_code: dict[str, dict] = {}
        self.vocab: set[str] = set()
        self.prefix4: set[str] = set()
        for med in medicines:
            code = str(med.get("pmbi_code", "")).strip()
            if not code:
                continue
            text = " ".join(filter(None, [med.get("composition"), med.get("generic_name")]))
            primary = med.get("composition") or med.get("generic_name") or med.get("brand_name") or ""
            words = set(_alpha_tokens(primary)) or set(_alpha_tokens(text))
            entry = {
                "med": med,
                "code": code,
                "words": words,
                "numbers": set(_numbers(" ".join(filter(None, [med.get("generic_name"), med.get("composition")])))),
                "release": bool(RELEASE_WORDS & set(re.findall(r"[a-z]+", text.lower()))),
                "forms": forms_in(" ".join(filter(None, [med.get("generic_name"), med.get("brand_name")]))),
                "pack": _norm_pack(med.get("pack_size")),
            }
            self.entries.append(entry)
            self.by_code[code] = entry
            self.vocab |= words
        self.prefix4 = {w[:4] for w in self.vocab if len(w) >= 4}

    def looks_like_ingredient(self, token: str) -> bool:
        if token in BRAND_TO_GENERIC:
            return True
        if len(token) >= 4 and token[:4] in self.prefix4:
            return True
        return bool(difflib.get_close_matches(token, self.vocab, n=1, cutoff=0.85))


def _norm_pack(value: Any) -> Optional[str]:
    match = re.search(r"\d+", str(value or ""))
    return match.group(0) if match else None


def _display_name(med: dict) -> str:
    return med.get("generic_name") or med.get("brand_name") or str(med.get("pmbi_code"))


def parse_item_text(item_name: str, composition_hint: Optional[str], code_hint: Optional[str],
                    index: CatalogueIndex) -> dict:
    """
    Printed item text -> what we search with:
    ingredient tokens, strengths, release flag.
    """
    text = item_name or ""
    main = PAREN_REMOVE.sub(" ", text)

    if composition_hint:
        # "(CLOPI 75 & ASPRN 15)" - a composition in brackets beats the brand name
        tokens = [t for t in _alpha_tokens(composition_hint)]
        numbers = _numbers(composition_hint)
        if not numbers:
            numbers = _numbers(main)
    else:
        tokens = []
        words = re.findall(r"[a-z]+", main.lower())
        # brand alias ("PAN D", "DOLO")
        alias = None
        for key in (" ".join(words[:2]), words[0] if words else ""):
            if key and key in BRAND_TO_GENERIC:
                alias = list(BRAND_TO_GENERIC[key])
                break
        if alias:
            for generic in alias:
                tokens.extend(_alpha_tokens(generic))
        else:
            tokens = [t for t in _alpha_tokens(main) if index.looks_like_ingredient(t)]
        numbers = _numbers(main)

    # drop a leading/trailing code like (456) from the strengths
    if code_hint:
        code_value = float(code_hint)
        if not composition_hint and code_value in numbers and len(numbers) > 1:
            numbers.remove(code_value)

    # de-duplicate, keep order
    seen = set()
    tokens = [t for t in tokens if not (t in seen or seen.add(t))]

    return {
        "tokens": tokens,
        "numbers": numbers,
        "forms": forms_in(text),
        "release": bool(RELEASE_SUFFIX.search(text.upper())) or bool(RELEASE_WORDS & set(re.findall(r"[a-z]+", text.lower()))),
    }


PAREN_REMOVE = re.compile(r"\([^()]*\)")


def score_entry(query: dict, entry: dict, pack: Optional[str]) -> float:
    tokens = query["tokens"]
    if not tokens or not entry["words"]:
        return 0.0

    best_per_token = []
    matched_words: set[str] = set()
    for token in tokens:
        best = 0.0
        for word in entry["words"]:
            s = token_vs_word(token, word)
            if s > best:
                best = s
            if s >= 0.85:
                matched_words.add(word)
        best_per_token.append(best)
    qcov = sum(best_per_token) / len(tokens)
    if qcov == 0:
        return 0.0
    ccov = len(matched_words) / len(entry["words"])

    if query["numbers"]:
        parts = []
        for number in query["numbers"]:
            if number in entry["numbers"]:
                parts.append(1.0)
            elif any(
                len(_fmt(number)) >= 2 and _fmt(c).startswith(_fmt(number)) for c in entry["numbers"]
            ):
                parts.append(0.7)       # "ASPRN 15" is "150" cut short by the printer / OCR
            else:
                parts.append(0.0)
        nscore = sum(parts) / len(parts)
    else:
        nscore = 0.6

    score = 0.45 * qcov + 0.30 * ccov + 0.25 * nscore
    if query["numbers"] and nscore == 0:
        score *= 0.5                      # right drug, wrong strength -> never "high"
    if query["release"] != entry["release"]:
        score -= 0.12
    if query["forms"] and entry["forms"] and not (query["forms"] & entry["forms"]):
        solid = {"tablet", "capsule"}
        score -= 0.05 if (query["forms"] <= solid and entry["forms"] <= solid) else 0.15
    if pack and entry["pack"] and pack == entry["pack"]:
        score += 0.03
    return max(0.0, min(1.0, score))


def _fmt(number: float) -> str:
    return str(int(number)) if float(number).is_integer() else str(number)


HIGH = 0.88          # auto-selected, shown green
REVIEW = 0.55        # pre-selected but shown amber; below this it is "unmatched"


def match_row(row: dict, index: CatalogueIndex, limit: int = 4) -> dict:
    """
    Returns {"best": {...}|None, "level": "high"|"review"|"none", "candidates": [...]}.
    """
    # 1. the file itself gave a PMBI code
    code = (row.get("pmbi_code") or "").strip()
    if code and code in index.by_code:
        return _result([(1.0, index.by_code[code])], "high", limit, reason="code column")

    query = parse_item_text(row.get("item_name") or "", row.get("composition_hint"), row.get("code_hint"), index)
    pack = _norm_pack(row.get("pack_size"))

    scored = []
    for entry in index.entries:
        s = score_entry(query, entry, pack)
        if s > 0.3:
            scored.append((s, entry))

    # 2. PMBI code printed in brackets - trusted only when the name agrees
    hint = row.get("code_hint")
    if hint and hint in index.by_code:
        entry = index.by_code[hint]
        agrees = score_entry(query, entry, pack)
        name_ok = agrees >= 0.45 or (query["tokens"] and any(
            token_vs_word(t, w) >= 0.85 for t in query["tokens"] for w in entry["words"]))
        if name_ok:
            scored = [(s, e) for s, e in scored if e["code"] != hint]
            scored.append((max(agrees, 0.97), entry))

    if not scored:
        return {"best": None, "level": "none", "candidates": []}

    scored.sort(key=lambda pair: (-pair[0], pair[1]["code"]))
    top = scored[0][0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    if top >= HIGH and top - runner_up >= 0.04:
        level = "high"
    elif top >= REVIEW:
        level = "review"
    else:
        level = "none"
    return _result(scored, level, limit)


def _result(scored: list[tuple[float, dict]], level: str, limit: int, reason: str = "") -> dict:
    candidates = [
        {
            "pmbi_code": entry["code"],
            "name": _display_name(entry["med"]),
            "pack_size": entry["med"].get("pack_size"),
            "jan_aushadhi_mrp": entry["med"].get("jan_aushadhi_mrp"),
            "score": round(score, 3),
        }
        for score, entry in scored[:limit]
    ]
    best = candidates[0] if level != "none" else None
    return {"best": best, "level": level, "candidates": candidates, "reason": reason}