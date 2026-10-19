from datetime import datetime
from typing import Dict, List, Literal, Optional

import re

from pydantic import BaseModel, Field, field_validator


VerificationStatus = Literal[
    "verified",
    "distributor",
    "unverified",
]


class BatchResponse(BaseModel):
    batch_number: str
    expiry_date: datetime
    quantity: int
    manufacturer: str
    selling_price: Optional[float] = None
    verification_status: VerificationStatus = "unverified"


class StockItemResponse(BaseModel):
    pmbi_code: str
    total_qty: int
    status: str

    batches: List[BatchResponse] = Field(
        default_factory=list,
    )


class KendraResponse(BaseModel):
    id: str
    name: str
    address: str
    phone: Optional[str] = None
    rating: Optional[float] = None
    owner_email: Optional[str] = None
    latitude: float
    longitude: float
    distance_km: Optional[float] = None

    stock: List[StockItemResponse] = Field(
        default_factory=list,
    )


class KendraListResponse(BaseModel):
    total: int
    results: List[KendraResponse]


class ScoreBreakdown(BaseModel):
    distance_score: float
    price_score: float
    quantity_score: float
    freshness_score: float
    trust_score: float


class RankingWeightsResponse(BaseModel):
    distance: float
    price: float
    quantity: float
    freshness: float
    trust: float


class MedicineAvailabilityResponse(BaseModel):
    rank: int
    kendra_id: str
    kendra_name: str
    address: str
    phone: Optional[str] = None
    latitude: float
    longitude: float

    distance_km: float
    price: float
    total_qty: int
    status: str

    nearest_expiry: Optional[datetime] = None
    days_to_expiry: int = 0

    verification_status: VerificationStatus
    wsm_score: float

    score_breakdown: ScoreBreakdown
    weights_used: RankingWeightsResponse

    batches: List[BatchResponse] = Field(
        default_factory=list,
    )


class RestockRequest(BaseModel):
    pmbi_code: str = Field(
        ...,
        min_length=2,
        max_length=30,
    )

    batch_number: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    expiry_date: datetime

    quantity: int = Field(
        ...,
        gt=0,
    )

    manufacturer: str = Field(
        ...,
        min_length=2,
        max_length=150,
    )

    selling_price: Optional[float] = Field(
        default=None,
        gt=0,
        description=(
            "Actual selling price at this Kendra. "
            "Catalogue price is used when omitted."
        ),
    )

    verification_status: VerificationStatus = Field(
        default="unverified",
    )


class BillItemRequest(BaseModel):
    pmbi_code: str = Field(
        ...,
        min_length=2,
        max_length=30,
    )

    quantity: int = Field(
        ...,
        gt=0,
    )


PaymentMethod = Literal[
    "cash",
    "upi",
    "card",
]


class BillRequest(BaseModel):
    items: List[BillItemRequest] = Field(
        ...,
        min_length=1,
    )

    # "Patient" on the printed invoice
    customer_name: Optional[str] = Field(
        default=None,
        max_length=100,
    )

    customer_phone: Optional[str] = Field(
        default=None,
        max_length=20,
    )

    # "Dr:" on the printed invoice
    doctor_name: Optional[str] = Field(
        default=None,
        max_length=100,
    )

    discount: float = Field(
        default=0.0,
        ge=0,
        description="Flat discount in rupees, taken off the MRP total.",
    )

    gst_percentage: float = Field(
        default=0.0,
        ge=0,
        le=28,
        description=(
            "GST rate already INCLUDED in the MRP. The invoice shows how "
            "much of the bill is tax (CGST + SGST); it is not added on top."
        ),
    )

    payment_method: PaymentMethod = "cash"


class BillLineItemResponse(BaseModel):
    pmbi_code: str
    medicine_name: str
    item_name: str
    pack_size: Optional[str] = None
    quantity: int
    unit_price: float
    line_total: float
    batches_used: List[dict]


class BillResponse(BaseModel):
    bill_id: str
    bill_number: str
    kendra_id: str
    kendra: dict
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    doctor_name: Optional[str] = None
    items: List[BillLineItemResponse]
    subtotal: float
    discount: float
    taxable_value: float
    gst_percentage: float
    cgst: float
    sgst: float
    gst_amount: float
    round_off: float
    total_amount: float
    payment_method: PaymentMethod
    billed_by_name: Optional[str] = None
    billed_at: datetime


GSTIN_PATTERN = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$")


class BillingDetailsRequest(BaseModel):
    """Shop details printed on every invoice."""

    gstin: Optional[str] = Field(default=None, max_length=15)
    drug_license_no: Optional[str] = Field(default=None, max_length=120)
    next_bill_number: Optional[int] = Field(
        default=None,
        ge=1,
        description=(
            "Continue an existing bill book: the next bill gets this number. "
            "Must be higher than the last number used."
        ),
    )

    @field_validator("gstin")
    @classmethod
    def _check_gstin(cls, v):
        if v is None or not v.strip():
            return None
        v = v.strip().upper()
        if not GSTIN_PATTERN.match(v):
            raise ValueError("GSTIN must be 15 characters, e.g. 29DPSPS0749G1Z5.")
        return v

    @field_validator("drug_license_no")
    @classmethod
    def _clean_dl(cls, v):
        if v is None or not v.strip():
            return None
        return v.strip()