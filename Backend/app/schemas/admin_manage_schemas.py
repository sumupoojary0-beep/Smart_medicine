"""Request schemas for admin user and medicine management."""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class UserStatusRequest(BaseModel):
    status: Literal["ACTIVE", "SUSPENDED"]


class UserRoleRequest(BaseModel):
    role: Literal["USER", "ADMIN"]


class MedicineWrite(BaseModel):
    pmbi_code: str = Field(..., min_length=1, max_length=30)
    generic_name: str = Field(..., min_length=2, max_length=200)
    brand_name: str = Field(..., min_length=2, max_length=200)
    composition: str = Field(..., min_length=2, max_length=300)
    category: str = Field(..., min_length=2, max_length=100)
    jan_aushadhi_mrp: float = Field(..., ge=0, le=100000)
    branded_avg_mrp: float = Field(default=0, ge=0, le=100000)
    pack_size: str = Field(default="", max_length=50)
    manufacturer: str = Field(default="Bureau of Pharma PSUs of India (BPPI)", min_length=2, max_length=150)

    @field_validator("pmbi_code", "generic_name", "brand_name", "composition", "category", "pack_size", "manufacturer")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()