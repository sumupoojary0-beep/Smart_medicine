"""Request schemas for pharmacy-owner registration."""

from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


class PharmacyRegisterRequest(BaseModel):
    # account details (same rules as the normal sign-up)
    full_name: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    phone_number: str = Field(..., min_length=10, max_length=15)
    password: str = Field(..., min_length=8, max_length=100)

    # which Kendra the person runs
    kendra_id: str = Field(..., min_length=12, max_length=40)
    license_no: Optional[str] = Field(default=None, max_length=60)
    message: Optional[str] = Field(default=None, max_length=500)

    @field_validator("license_no", "message")
    @classmethod
    def _blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class RejectRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)