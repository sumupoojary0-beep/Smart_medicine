"""
Brand-name -> generic-ingredient aliases used by medicine_matcher.py.

Prescriptions are very often written with BRAND names ("Dolo 650",
"Pan 40", "Augmentin 625") while the Jan Aushadhi catalogue lists
GENERIC names. This table lets the matcher turn a brand into its
ingredient(s) so the right generic can be suggested.

IMPORTANT
  * Ingredient names must be lower-case and use the matcher's
    canonical spelling (amoxicillin, not amoxycillin; clavulanic acid,
    not potassium clavulanate; no salts such as "hydrochloride").
  * Brands that already exist in the catalogue (the `brand_name`
    column) are picked up automatically and take priority over this
    table, so this file only needs brands that are NOT in the catalogue.
  * Review this list before relying on it, and extend it as you meet
    new brands. Every suggestion still requires confirmation by the
    patient / doctor / pharmacist.
"""

BRAND_TO_GENERIC: dict[str, tuple[str, ...]] = {
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
    "amlong": ("amlodipine",),
    "norvasc": ("amlodipine",),
    "stamlo": ("amlodipine",),
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

# Brands whose trailing number is a PRODUCT CODE, not a plain mg value.
# {brand: {number printed on the strip: (strength, strength, ...)}}
_AMOXICLAV_CODES = {
    "625": ("500mg", "125mg"),
    "375": ("250mg", "125mg"),
    "1000": ("875mg", "125mg"),
}

BRAND_STRENGTH_MAP: dict[str, dict[str, tuple[str, ...]]] = {
    "augmentin": _AMOXICLAV_CODES,
    "clavam": _AMOXICLAV_CODES,
    "moxclav": _AMOXICLAV_CODES,
}

# Brands sold in one standard strength when no number is written.
BRAND_DEFAULT_STRENGTHS: dict[str, tuple[str, ...]] = {
    "combiflam": ("400mg", "325mg"),
}