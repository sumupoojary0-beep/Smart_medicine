"""Request schemas for importing stock from a supplier bill."""

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.kendra_schemas import VerificationStatus


class StockImportRow(BaseModel):
    """One reviewed line of the supplier bill, ready to become a stock batch."""

    pmbi_code: str = Field(..., min_length=1, max_length=30)
    batch_number: str = Field(..., min_length=1, max_length=100)
    expiry_date: date
    quantity: int = Field(..., gt=0, le=100000)
    manufacturer: Optional[str] = Field(default=None, max_length=150)
    selling_price: Optional[float] = Field(default=None, gt=0)
    purchase_rate: Optional[float] = Field(default=None, ge=0)
    mrp: Optional[float] = Field(default=None, ge=0)
    item_name: Optional[str] = Field(default=None, max_length=250)

    @field_validator("batch_number")
    @classmethod
    def _tidy_batch(cls, value: str) -> str:
        value = value.strip().upper()
        if not value:
            raise ValueError("Batch number is required.")
        return value


class StockImportConfirmRequest(BaseModel):
    rows: List[StockImportRow] = Field(..., min_length=1, max_length=500)
    invoice_no: Optional[str] = Field(default=None, max_length=60)
    invoice_date: Optional[date] = None
    supplier_name: Optional[str] = Field(default=None, max_length=120)
    verification_status: VerificationStatus = "distributor"
    source: Optional[str] = Field(default=None, max_length=20)
    file_name: Optional[str] = Field(default=None, max_length=200)
    allow_duplicate: bool = False

    @field_validator("invoice_no", "supplier_name")
    @classmethod
    def _blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None