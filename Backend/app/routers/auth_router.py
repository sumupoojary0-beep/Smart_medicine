from fastapi import APIRouter, Depends, Query

from app.schemas.auth_schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResendOTPRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyOTPRequest,
)
from app.schemas.token_schema import TokenPayload
from app.services.auth_service import (
    get_current_user_profile,
    login_user,
    register_user,
    resend_registration_otp,
    verify_registration_otp,
)
from app.services.password_reset_service import (
    check_reset_otp,
    forgot_password,
    reset_password,
)
from app.utils.jwt_helper import get_current_user


router = APIRouter(
    prefix="/api/v1/auth",
    tags=["Authentication"],
)


@router.get("/health")
async def authentication_health():
    """Check whether the authentication module is running."""

    return {
        "success": True,
        "module": "Authentication",
        "message": "Authentication Router is Working Successfully",
    }


@router.post("/register")
async def register(user_data: RegisterRequest):
    """Register a new user and send an email OTP."""

    return await register_user(user_data)


@router.post("/verify-otp")
async def verify_otp(data: VerifyOTPRequest, flow: str = Query(default="register")):
    """Verify the six-digit OTP (flow=register: sign-up code, flow=reset: password-reset code)."""

    if flow == "reset":
        return await check_reset_otp(email=data.email, otp=data.otp)

    return await verify_registration_otp(
        email=data.email,
        otp=data.otp,
    )


@router.post("/resend-otp")
async def resend_otp(data: ResendOTPRequest, flow: str = Query(default="register")):
    """Generate and email a new OTP."""

    if flow == "reset":
        return await forgot_password(data.email)

    return await resend_registration_otp(
        email=data.email,
    )


@router.post("/forgot-password")
async def forgot_password_route(data: ForgotPasswordRequest):
    """Email a password-reset code (same answer whether or not the account exists)."""

    return await forgot_password(data.email)


@router.post("/reset-password")
async def reset_password_route(data: ResetPasswordRequest):
    """Check the reset code and save the new password."""

    return await reset_password(data.email, data.otp, data.new_password)


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """Authenticate a verified user."""

    return await login_user(credentials)


@router.get("/me")
async def get_me(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Return the currently authenticated user's profile."""

    return await get_current_user_profile(
        current_user.sub,
    )