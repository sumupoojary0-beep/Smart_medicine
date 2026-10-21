from fastapi import APIRouter, Depends, Query

from app.schemas.auth_schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
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
from app.services.refresh_token_service import revoke_refresh_token, rotate_refresh_token
from app.services.password_reset_service import (
    check_reset_otp,
    forgot_password,
    reset_password,
)
from app.utils.jwt_helper import get_current_user
from app.utils.rate_limit import check_limit, ip_limit


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


@router.post("/register", dependencies=[Depends(ip_limit("register", 10, 3600))])
async def register(user_data: RegisterRequest):
    """Register a new user and send an email OTP."""

    check_limit("register-email", user_data.email, 5, 3600)

    return await register_user(user_data)


@router.post("/verify-otp", dependencies=[Depends(ip_limit("verify-otp", 30, 600))])
async def verify_otp(data: VerifyOTPRequest, flow: str = Query(default="register")):
    """Verify the six-digit OTP (flow=register: sign-up code, flow=reset: password-reset code)."""

    check_limit("verify-otp-email", data.email, 10, 600)

    if flow == "reset":
        return await check_reset_otp(email=data.email, otp=data.otp)

    return await verify_registration_otp(
        email=data.email,
        otp=data.otp,
    )


@router.post("/resend-otp", dependencies=[Depends(ip_limit("resend-otp", 10, 900))])
async def resend_otp(data: ResendOTPRequest, flow: str = Query(default="register")):
    """Generate and email a new OTP."""

    check_limit("otp-email", data.email, 5, 900)

    if flow == "reset":
        return await forgot_password(data.email)

    return await resend_registration_otp(
        email=data.email,
    )


@router.post("/forgot-password", dependencies=[Depends(ip_limit("forgot-password", 10, 900))])
async def forgot_password_route(data: ForgotPasswordRequest):
    """Email a password-reset code (same answer whether or not the account exists)."""

    check_limit("otp-email", data.email, 5, 900)

    return await forgot_password(data.email)


@router.post("/reset-password", dependencies=[Depends(ip_limit("reset-password", 20, 900))])
async def reset_password_route(data: ResetPasswordRequest):
    """Check the reset code and save the new password."""

    check_limit("reset-email", data.email, 10, 900)

    return await reset_password(data.email, data.otp, data.new_password)


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(ip_limit("login", 20, 60))])
async def login(credentials: LoginRequest):
    """Authenticate a verified user."""

    check_limit("login-email", credentials.email, 10, 900)

    return await login_user(credentials)


@router.post("/refresh-token", response_model=TokenResponse, dependencies=[Depends(ip_limit("refresh", 60, 60))])
async def refresh_token(data: RefreshRequest):
    """Swap a valid refresh token for a new access token + new refresh token."""

    return await rotate_refresh_token(data.refresh_token)


@router.post("/logout")
async def logout(data: RefreshRequest):
    """Sign out: the refresh token can no longer be used."""

    await revoke_refresh_token(data.refresh_token)
    return {"message": "Signed out."}


@router.get("/me")
async def get_me(
    current_user: TokenPayload = Depends(get_current_user),
):
    """Return the currently authenticated user's profile."""

    return await get_current_user_profile(
        current_user.sub,
    )