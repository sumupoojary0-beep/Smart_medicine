from fastapi import APIRouter, Depends, Query

from app.schemas.token_schema import TokenPayload
from app.services.audit_service import list_logs
from app.utils.constants import UserRole
from app.utils.jwt_helper import require_role

router = APIRouter(prefix="/api/v1/admin", tags=["Admin - audit log"])


@router.get("/audit-logs")
async def audit_logs(
    q: str = Query(default="", max_length=80),
    target_type: str | None = Query(default=None, pattern="^(user|medicine|kendra|pharmacy_request)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    current_user: TokenPayload = Depends(require_role([UserRole.ADMIN])),
):
    """Who changed what. Admin only, newest first."""
    return await list_logs(q=q, target_type=target_type, page=page, page_size=page_size)