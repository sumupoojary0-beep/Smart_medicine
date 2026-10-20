from fastapi import APIRouter, Depends, Query

from app.schemas.admin_manage_schemas import MedicineWrite, UserRoleRequest, UserStatusRequest
from app.schemas.token_schema import TokenPayload
from app.services.admin_manage_service import (
    create_medicine,
    get_overview,
    list_medicines,
    list_users,
    set_medicine_active,
    set_user_role,
    set_user_status,
    update_medicine,
)
from app.utils.constants import UserRole
from app.utils.jwt_helper import require_role

router = APIRouter(prefix="/api/v1/admin", tags=["Admin - overview, users, medicines"])

_ADMIN = Depends(require_role([UserRole.ADMIN]))


@router.get("/overview")
async def overview(current_user: TokenPayload = _ADMIN):
    return await get_overview()


@router.get("/users")
async def users(q: str = Query(default="", max_length=80), role: str | None = Query(default=None),
                status: str | None = Query(default=None), page: int = Query(default=1, ge=1),
                page_size: int = Query(default=10, ge=1, le=50), current_user: TokenPayload = _ADMIN):
    return await list_users(q, role, status, page, page_size)


@router.post("/users/{user_id}/status")
async def user_status(user_id: str, body: UserStatusRequest, current_user: TokenPayload = _ADMIN):
    return await set_user_status(user_id, body.status, current_user.sub)


@router.post("/users/{user_id}/role")
async def user_role(user_id: str, body: UserRoleRequest, current_user: TokenPayload = _ADMIN):
    return await set_user_role(user_id, body.role, current_user.sub)


@router.get("/medicines")
async def medicines(q: str = Query(default="", max_length=80), category: str | None = Query(default=None),
                    visibility: str = Query(default="all", pattern="^(all|active|hidden)$"),
                    page: int = Query(default=1, ge=1), page_size: int = Query(default=15, ge=1, le=50),
                    current_user: TokenPayload = _ADMIN):
    return await list_medicines(q, category, visibility, page, page_size)


@router.post("/medicines", status_code=201)
async def add_medicine(data: MedicineWrite, current_user: TokenPayload = _ADMIN):
    return await create_medicine(data)


@router.put("/medicines/{code}")
async def edit_medicine(code: str, data: MedicineWrite, current_user: TokenPayload = _ADMIN):
    return await update_medicine(code, data)


@router.post("/medicines/{code}/hide")
async def hide_medicine(code: str, current_user: TokenPayload = _ADMIN):
    return await set_medicine_active(code, False)


@router.post("/medicines/{code}/show")
async def show_medicine(code: str, current_user: TokenPayload = _ADMIN):
    return await set_medicine_active(code, True)