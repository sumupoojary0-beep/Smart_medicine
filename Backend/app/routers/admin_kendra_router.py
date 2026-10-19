from fastapi import APIRouter, Depends, Query

from app.schemas.admin_kendra_schemas import KendraWrite
from app.schemas.token_schema import TokenPayload
from app.services.admin_kendra_service import (
    create_kendra,
    delete_kendra,
    list_kendras,
    remove_owner,
    set_active,
    update_kendra,
)
from app.utils.constants import UserRole
from app.utils.jwt_helper import require_role

router = APIRouter(
    prefix="/api/v1/admin/kendras",
    tags=["Admin - Kendras"],
)

_ADMIN = [UserRole.ADMIN]


@router.get("")
async def kendras(q: str = Query(default="", max_length=80),
                  current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await list_kendras(q)


@router.post("", status_code=201)
async def add(data: KendraWrite, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await create_kendra(data)


@router.put("/{kendra_id}")
async def edit(kendra_id: str, data: KendraWrite, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await update_kendra(kendra_id, data)


@router.post("/{kendra_id}/hide")
async def hide(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await set_active(kendra_id, False)


@router.post("/{kendra_id}/show")
async def show(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await set_active(kendra_id, True)


@router.post("/{kendra_id}/remove-owner")
async def unlink_owner(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await remove_owner(kendra_id)


@router.delete("/{kendra_id}")
async def delete(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ADMIN))):
    return await delete_kendra(kendra_id)