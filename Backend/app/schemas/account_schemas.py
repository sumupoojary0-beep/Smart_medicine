import re

from pydantic import BaseModel, Field, field_validator


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=100)
    phone_number: str = Field(..., min_length=10, max_length=15)

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("phone_number")
    @classmethod
    def _phone(cls, value: str) -> str:
        cleaned = value.strip()
        if not re.fullmatch(r"\+?\d{10,14}", cleaned):
            raise ValueError("Enter a valid phone number (digits only).")
        return cleaned


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=8, max_length=100)
    new_password: str = Field(..., min_length=8, max_length=100)