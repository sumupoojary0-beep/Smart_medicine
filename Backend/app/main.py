from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.database.connection import (
    close_mongodb_connection,
    connect_to_mongodb,
)
from app.routers.admin_router import router as admin_router
from app.routers.auth_router import router as auth_router
from app.routers.kendra_router import router as kendra_router
from app.routers.medicine_router import router as medicine_router
from app.routers.notification_router import router as notification_router
from app.routers.report_router import router as report_router
from app.routers.pharmacy_registration_router import router as pharmacy_registration_router
from app.routers.admin_kendra_router import router as admin_kendra_router
from app.routers.admin_manage_router import router as admin_manage_router
from app.routers.user_router import router as user_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongodb()

    try:
        yield
    finally:
        await close_mongodb_connection()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)


# Allow frontend development servers running on any localhost port.
# This covers localhost:5173, 127.0.0.1:5173, localhost:5174, etc.
LOCAL_FRONTEND_ORIGIN_REGEX = (
    r"^https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=LOCAL_FRONTEND_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=[
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

app.include_router(admin_kendra_router)
app.include_router(auth_router)
app.include_router(medicine_router)
app.include_router(kendra_router)
app.include_router(notification_router)
app.include_router(admin_router)
app.include_router(report_router)
app.include_router(pharmacy_registration_router)
app.include_router(admin_manage_router)
app.include_router(user_router)

@app.get("/")
async def root():
    return {
        "message": (
            "Smart Medicine Availability & Intelligent "
            "Janaushadhi Recommendation System Backend is Running"
        )
    }


@app.get("/health")
async def health_check():
    return {
        "success": True,
        "service": "backend",
        "status": "healthy",
        "port": 8002,
    }