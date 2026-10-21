from datetime import datetime, timedelta, timezone
from app.schemas.token_schema import TokenPayload
from fastapi import HTTPException, status
from jose import JWTError, jwt
from app.core.config import settings
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends
from typing import List
def create_access_token(data: dict) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
    minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
    to_encode,
    settings.SECRET_KEY,
    algorithm=settings.ALGORITHM
)
    return encoded_jwt
def verify_access_token(token: str) -> dict:
    """ Verify a JWT access token and return its payload."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return TokenPayload(**payload)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token."
    )
bearer_scheme = HTTPBearer()
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)
) -> TokenPayload:
    """Get the current authenticated user from the JWT, re-checked against the database.

    A valid token is not enough: the account must still exist and be ACTIVE,
    and the role is taken from the database, so suspending a user or changing
    their role takes effect immediately.
    """
    payload = verify_access_token(credentials.credentials)

    from app.database.connection import get_database  # local import avoids a cycle

    user = await get_database().users.find_one({"email": payload.sub})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    if user.get("status") != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive.",
        )
    return TokenPayload(sub=payload.sub, role=str(getattr(user["role"], "value", user["role"])), exp=payload.exp)
    
def require_role(
    allowed_roles: list[str]
):
    """Create a dependency that allows access only to the specified roles."""
    async def role_checker(
        current_user: TokenPayload = Depends(get_current_user)
    ) -> TokenPayload:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action."
            )
        return current_user

    return role_checker


optional_bearer_scheme = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
) -> TokenPayload | None:
    """Like get_current_user, but returns None for anonymous or invalid callers."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None