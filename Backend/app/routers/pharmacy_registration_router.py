from fastapi import APIRouter, Depends, Query

from app.schemas.pharmacy_registration_schemas import PharmacyRegisterRequest, RejectRequest
from app.schemas.token_schema import TokenPayload
from app.services.pharmacy_registration_service import (
    approve_request,
    get_my_request,
    list_requests,
    register_pharmacy_owner,
    reject_request,
    search_open_kendras,
)
from app.services.audit_service import record
from app.utils.constants import UserRole
from app.utils.jwt_helper import get_current_user, require_role
from app.utils.rate_limit import ip_limit

router = APIRouter(
    prefix="/api/v1/pharmacy-registration",
    tags=["Pharmacy registration"],
)


@router.get("/kendras")
async def open_kendras(q: str = Query(default="", max_length=80), limit: int = Query(default=20, ge=1, le=50)):
    """Public: Kendras that do not have an owner yet (for the signup dropdown)."""
    return await search_open_kendras(q, limit)


@router.post("/register", status_code=201, dependencies=[Depends(ip_limit("pharmacy-register", 10, 3600))])
async def register(data: PharmacyRegisterRequest):
    """Public: create an account + a PENDING pharmacy-owner request."""
    return await register_pharmacy_owner(data)


@router.get("/my-request")
async def my_request(current_user: TokenPayload = Depends(get_current_user)):
    return await get_my_request(current_user.sub)


@router.get("/requests")
async def requests_list(
    status: str | None = Query(default=None),
    current_user: TokenPayload = Depends(require_role([UserRole.ADMIN])),
):
    return await list_requests(status)


@router.post("/requests/{request_id}/approve")
async def approve(request_id: str, current_user: TokenPayload = Depends(require_role([UserRole.ADMIN]))):
    result = await approve_request(request_id, current_user.sub)
    await record(current_user.sub, "pharmacy_request.approve", "pharmacy_request", request_id, "Approved pharmacy owner request")
    return result


@router.post("/requests/{request_id}/reject")
async def reject(
    request_id: str,
    body: RejectRequest,
    current_user: TokenPayload = Depends(require_role([UserRole.ADMIN])),
):
    result = await reject_request(request_id, current_user.sub, body.reason)
    await record(current_user.sub, "pharmacy_request.reject", "pharmacy_request", request_id, "Rejected pharmacy owner request", {"reason": body.reason})
    return result