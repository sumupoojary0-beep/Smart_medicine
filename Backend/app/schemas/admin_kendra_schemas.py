"""Request schemas for admin Kendra management."""

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class KendraWrite(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    address: str = Field(..., min_length=2, max_length=300)
    phone: Optional[str] = Field(default=None, max_length=20)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    is_active: bool = True

    @field_validator("name", "address")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Too short.")
        return value

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None