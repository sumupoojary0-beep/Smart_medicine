"""
Brand-name -> active-ingredient table used by the medicine search.

The Jan Aushadhi catalogue lists GENERIC names (plus a few brands). When a
user searches a brand that is not in the catalogue (e.g. "Amlodac"), the
search looks the brand up here and returns the Jan Aushadhi generic(s)
with the same ingredient(s).

Rules:
  * keys are lower-case brand names WITHOUT strength ("amlodac", "pan d")
  * values are lower-case ingredient names, no salts
    ("amlodipine", not "amlodipine besylate")
  * review before relying on it, and extend it as you meet new brands
"""

BRAND_TO_GENERIC: dict[str, tuple[str, ...]] = {
    # --- Amlodipine ---
    "amlong": ("amlodipine",),
    "amlodac": ("amlodipine",),
    "norvasc": ("amlodipine",),
    "stamlo": ("amlodipine",),
    # --- Paracetamol ---
    "dolo": ("paracetamol",),
    "crocin": ("paracetamol",),
    "calpol": ("paracetamol",),
    "pacimol": ("paracetamol",),
    # --- Pantoprazole / omeprazole ---
    "pan": ("pantoprazole",),
    "pantop": ("pantoprazole",),
    "pantocid": ("pantoprazole",),
    "pan d": ("pantoprazole", "domperidone"),
    "omez": ("omeprazole",),
    "ocid": ("omeprazole",),
    # --- Antibiotics ---
    "azithral": ("azithromycin",),
    "azee": ("azithromycin",),
    "zithromax": ("azithromycin",),
    "augmentin": ("amoxicillin", "clavulanic acid"),
    "clavam": ("amoxicillin", "clavulanic acid"),
    "moxclav": ("amoxicillin", "clavulanic acid"),
    "amoxil": ("amoxicillin",),
    "mox": ("amoxicillin",),
    "novamox": ("amoxicillin",),
    "ciplox": ("ciprofloxacin",),
    "cifran": ("ciprofloxacin",),
    "doxy": ("doxycycline",),
    "zifi": ("cefixime",),
    # --- Statins ---
    "atorva": ("atorvastatin",),
    "storvas": ("atorvastatin",),
    "lipitor": ("atorvastatin",),
    "rosuvas": ("rosuvastatin",),
    "crestor": ("rosuvastatin",),
    # --- Diabetes ---
    "glycomet": ("metformin",),
    "glucophage": ("metformin",),
    "amaryl": ("glimepiride",),
    "glimestar": ("glimepiride",),
    "diamicron": ("gliclazide",),
    # --- Blood pressure / heart ---
    "telma": ("telmisartan",),
    "telmikind": ("telmisartan",),
    "losar": ("losartan",),
    "cozaar": ("losartan",),
    "metolar": ("metoprolol",),
    "betaloc": ("metoprolol",),
    "ecosprin": ("aspirin",),
    "disprin": ("aspirin",),
    # --- Allergy / asthma ---
    "cetzine": ("cetirizine",),
    "okacet": ("cetirizine",),
    "levocet": ("levocetirizine",),
    "xyzal": ("levocetirizine",),
    "montair": ("montelukast",),
    "singulair": ("montelukast",),
    "asthalin": ("salbutamol",),
    # --- Pain / anti-inflammatory ---
    "brufen": ("ibuprofen",),
    "combiflam": ("ibuprofen", "paracetamol"),
    "voveran": ("diclofenac",),
    "nise": ("nimesulide",),
    "nimulid": ("nimesulide",),
    # --- Stomach ---
    "rantac": ("ranitidine",),
    "zinetac": ("ranitidine",),
    "aciloc": ("ranitidine",),
    "domstal": ("domperidone",),
    "motilium": ("domperidone",),
    # --- Vitamins / thyroid ---
    "folvite": ("folic acid",),
    "thyronorm": ("levothyroxine",),
    "eltroxin": ("levothyroxine",),
}

# Catalogue spelling differs from the common spelling for some ingredients.
INGREDIENT_REGEX: dict[str, str] = {
    "amoxicillin": "amoxy?cillin",
    "clavulanic acid": "clavulan",
    "folic acid": "folic",
}