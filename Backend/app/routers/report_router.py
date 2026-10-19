from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.schemas.token_schema import TokenPayload
from app.services.report_service import expired_pdf, out_of_stock_pdf
from app.utils.constants import UserRole
from app.utils.jwt_helper import require_role

router = APIRouter(
    prefix="/api/v1/kendras",
    tags=["Kendra reports"],
)

_ALLOWED = [UserRole.PHARMACY, UserRole.ADMIN]


def _pdf_response(pdf: bytes, filename: str) -> Response:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/{kendra_id}/reports/out-of-stock.pdf")
async def out_of_stock_report(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ALLOWED))):
    """PDF list of medicines with no sellable stock (expired units do not count)."""
    return _pdf_response(*await out_of_stock_pdf(kendra_id, current_user))


@router.get("/{kendra_id}/reports/expired.pdf")
async def expired_report(kendra_id: str, current_user: TokenPayload = Depends(require_role(_ALLOWED))):
    """PDF list of expired batches still in stock."""
    return _pdf_response(*await expired_pdf(kendra_id, current_user))