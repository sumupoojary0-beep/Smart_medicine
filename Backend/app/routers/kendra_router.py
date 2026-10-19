from fastapi import APIRouter, Depends, File, Query, UploadFile

from app.schemas.kendra_schemas import (
    RestockRequest,
    BillRequest,
    BillingDetailsRequest,
    PaymentMethod,
)
from app.schemas.stock_import_schemas import StockImportConfirmRequest
from app.schemas.token_schema import TokenPayload
from app.utils.jwt_helper import require_role
from app.utils.constants import UserRole
from app.services.kendra_service import (
    DEFAULT_RADIUS_KM,
    find_nearby_kendras,
    get_kendra_by_id,
    find_medicine_availability,
    restock_medicine,
    generate_bill,
    get_inventory_dashboard,
    get_billing_details,
    update_billing_details,
    list_bills,
    get_bill,
)
from app.services.stock_import_service import preview_import, confirm_import


router = APIRouter(
    prefix="/api/v1/kendras",
    tags=["Kendras"],
)


@router.get("/nearby")
async def nearby(
    lat: float = Query(
        ...,
        ge=-90,
        le=90,
        description="User latitude",
    ),
    lng: float = Query(
        ...,
        ge=-180,
        le=180,
        description="User longitude",
    ),
    radius_km: float = Query(
        default=DEFAULT_RADIUS_KM,
        gt=0,
        le=50,
    ),
):
    """
    Find active Jan Aushadhi Kendras near a location.

    This endpoint returns location results sorted by distance.
    Use the medicine-specific endpoint for WSM ranking.
    """
    return await find_nearby_kendras(
        lat=lat,
        lng=lng,
        radius_km=radius_km,
    )


@router.get("/medicine/{pmbi_code}/nearby")
async def medicine_nearby(
    pmbi_code: str,
    lat: float = Query(
        ...,
        ge=-90,
        le=90,
        description="User latitude",
    ),
    lng: float = Query(
        ...,
        ge=-180,
        le=180,
        description="User longitude",
    ),
    radius_km: float = Query(
        default=DEFAULT_RADIUS_KM,
        gt=0,
        le=50,
    ),
    only_in_stock: bool = Query(default=True),
    distance_weight: float = Query(
        default=0.35,
        ge=0,
        le=1,
        description="WSM weight for shorter distance",
    ),
    price_weight: float = Query(
        default=0.25,
        ge=0,
        le=1,
        description="WSM weight for lower price",
    ),
    quantity_weight: float = Query(
        default=0.20,
        ge=0,
        le=1,
        description="WSM weight for stock quantity",
    ),
    freshness_weight: float = Query(
        default=0.10,
        ge=0,
        le=1,
        description="WSM weight for longer remaining shelf life",
    ),
    trust_weight: float = Query(
        default=0.10,
        ge=0,
        le=1,
        description="WSM weight for batch verification",
    ),
):
    """
    Find Kendras stocking the requested medicine and rank them
    with the Weighted Sum Model.

    Normalized criteria:

    - distance: `1 - distance / maximum_distance`
    - price: `1 - price / maximum_price`
    - quantity: `min(quantity / 50, 1)`
    - freshness: `min(days_to_expiry / 365, 1)`
    - trust: verified=1.0, distributor=0.7, unverified=0.4

    The five supplied weights must add up to 1.0.
    """
    weights = {
        "distance": distance_weight,
        "price": price_weight,
        "quantity": quantity_weight,
        "freshness": freshness_weight,
        "trust": trust_weight,
    }

    return await find_medicine_availability(
        pmbi_code=pmbi_code,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        only_in_stock=only_in_stock,
        weights=weights,
    )


@router.get("/{kendra_id}")
async def detail(kendra_id: str):
    """
    Get a Kendra's complete details, stock and batches.
    """
    return await get_kendra_by_id(kendra_id)


@router.post("/{kendra_id}/restock")
async def restock(
    kendra_id: str,
    data: RestockRequest,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Add a stock batch. Pharmacy owner or administrator only.
    """
    return await restock_medicine(
        kendra_id,
        data,
        current_user,
    )


@router.post("/{kendra_id}/bill")
async def bill(
    kendra_id: str,
    data: BillRequest,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Generate a bill and deduct stock using FIFO/FEFO order.
    Pharmacy owner or administrator only.
    """
    return await generate_bill(
        kendra_id,
        data,
        current_user,
    )


@router.get("/{kendra_id}/inventory/dashboard")
async def inventory_dashboard(
    kendra_id: str,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Inventory summary for one Kendra: stock counts, low/out-of-stock,
    near-expiry and expired batches, sales and recent activity.
    Pharmacy owner or administrator only.
    """
    return await get_inventory_dashboard(kendra_id, current_user)


@router.get("/{kendra_id}/bills")
async def bill_history(
    kendra_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    search: str | None = Query(
        default=None,
        description="Bill number, customer name or phone",
    ),
    payment_method: PaymentMethod | None = None,
    date_from: str | None = Query(default=None, description="YYYY-MM-DD"),
    date_to: str | None = Query(default=None, description="YYYY-MM-DD"),
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Bill history for one Kendra, newest first, with filters.
    Pharmacy owner or administrator only.
    """
    return await list_bills(
        kendra_id,
        current_user,
        page=page,
        page_size=page_size,
        search=search,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/{kendra_id}/bills/{bill_id}")
async def bill_detail(
    kendra_id: str,
    bill_id: str,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    One bill with its line items and the batches used.
    Pharmacy owner or administrator only.
    """
    return await get_bill(kendra_id, bill_id, current_user)


@router.get("/{kendra_id}/billing-details")
async def billing_details(
    kendra_id: str,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Shop details printed on invoices (GSTIN, drug licence no.) and the
    last bill number used. Pharmacy owner or administrator only.
    """
    return await get_billing_details(kendra_id, current_user)


@router.put("/{kendra_id}/billing-details")
async def save_billing_details(
    kendra_id: str,
    data: BillingDetailsRequest,
    current_user: TokenPayload = Depends(
        require_role(
            [UserRole.PHARMACY, UserRole.ADMIN]
        )
    ),
):
    """
    Save the GSTIN / drug licence no. printed on invoices, and optionally
    continue an existing bill book from a given number.
    Pharmacy owner or administrator only.
    """
    return await update_billing_details(kendra_id, data, current_user)


@router.post("/{kendra_id}/stock-import/preview")
async def stock_import_preview(
    kendra_id: str,
    file: UploadFile = File(...),
    current_user: TokenPayload = Depends(
        require_role([UserRole.PHARMACY, UserRole.ADMIN])
    ),
):
    """
    Read a supplier bill (photo, PDF, Excel or CSV) and return the rows it
    contains, matched to the catalogue. Nothing is saved.
    """
    return await preview_import(kendra_id, file, current_user)


@router.post("/{kendra_id}/stock-import/confirm")
async def stock_import_confirm(
    kendra_id: str,
    data: StockImportConfirmRequest,
    current_user: TokenPayload = Depends(
        require_role([UserRole.PHARMACY, UserRole.ADMIN])
    ),
):
    """
    Add the reviewed rows of a supplier bill to this Kendra's stock.
    """
    return await confirm_import(kendra_id, data, current_user)