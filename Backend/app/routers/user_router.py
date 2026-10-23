from fastapi import APIRouter, Depends, status

from app.schemas.ranking_preferences_schemas import (
    RankingPreferences,
    RankingPreferencesResponse,
)
from app.schemas.account_schemas import ChangePasswordRequest, ProfileUpdateRequest
from app.schemas.token_schema import TokenPayload
from app.services.account_service import (
    change_password,
    list_saved,
    save_medicine,
    unsave_medicine,
    update_profile,
)
from app.utils.rate_limit import check_limit
from app.services.user_preference_service import (
    get_user_ranking_preferences,
    reset_user_ranking_preferences,
    save_user_ranking_preferences,
)
from app.utils.jwt_helper import get_current_user


# =====================================================
# User Router
# =====================================================

router = APIRouter(
    prefix="/api/v1/users",
    tags=["Users"],
)


# =====================================================
# Health check
# =====================================================

@router.get("/health")
async def user_module_health():
    """
    Check whether the user module is running.
    """

    return {
        "success": True,
        "module": "Users",
        "message": "User router is working successfully.",
    }


# =====================================================
# Get ranking preferences
# =====================================================

@router.get(
    "/me/ranking-preferences",
    response_model=RankingPreferencesResponse,
)
async def get_my_ranking_preferences(
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Return the logged-in user's saved WSM preferences.

    Default preferences are returned if the user has not
    saved custom preferences.
    """

    return await get_user_ranking_preferences(
        user_id=current_user.sub,
    )


# =====================================================
# Save ranking preferences
# =====================================================

@router.put(
    "/me/ranking-preferences",
    response_model=RankingPreferencesResponse,
)
async def update_my_ranking_preferences(
    preferences: RankingPreferences,
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Save or update the logged-in user's WSM preferences.

    All five weights must be between 0 and 1 and their
    total must equal 1.0.
    """

    return await save_user_ranking_preferences(
        user_id=current_user.sub,
        preferences=preferences,
    )


# =====================================================
# Reset ranking preferences
# =====================================================

@router.delete(
    "/me/ranking-preferences",
    response_model=RankingPreferencesResponse,
    status_code=status.HTTP_200_OK,
)
async def reset_my_ranking_preferences(
    current_user: TokenPayload = Depends(get_current_user),
):
    """
    Delete the logged-in user's custom preferences and
    return the default WSM preferences.
    """

    return await reset_user_ranking_preferences(
        user_id=current_user.sub,
    )


# =====================================================
# Own profile and password
# =====================================================

@router.put("/me/profile")
async def update_my_profile(
    body: ProfileUpdateRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Change the logged-in user's name and phone number."""
    return await update_profile(current_user.sub, body.full_name, body.phone_number)


@router.post("/me/change-password")
async def change_my_password(
    body: ChangePasswordRequest,
    current_user: TokenPayload = Depends(get_current_user),
):
    """Change password (needs the current one). Signs out other devices."""
    check_limit("change-password", current_user.sub, 5, 900)
    return await change_password(current_user.sub, body.current_password, body.new_password)


# =====================================================
# Saved medicines
# =====================================================

@router.get("/me/saved-medicines")
async def my_saved_medicines(current_user: TokenPayload = Depends(get_current_user)):
    return await list_saved(current_user.sub)


@router.put("/me/saved-medicines/{pmbi_code}")
async def save_one_medicine(pmbi_code: str, current_user: TokenPayload = Depends(get_current_user)):
    return await save_medicine(current_user.sub, pmbi_code)


@router.delete("/me/saved-medicines/{pmbi_code}")
async def unsave_one_medicine(pmbi_code: str, current_user: TokenPayload = Depends(get_current_user)):
    return await unsave_medicine(current_user.sub, pmbi_code)