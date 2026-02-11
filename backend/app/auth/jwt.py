from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.config import settings
from app.utils.time import utc_now

logger = logging.getLogger("app.auth")

_bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(subject: str) -> str:
    now = utc_now()
    exp = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload: Dict[str, Any] = {
        "sub": subject,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT token. Raises JWTError on failure."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        audience=settings.jwt_audience,
        issuer=settings.jwt_issuer,
    )


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[str]:
    """Return the subject claim from a valid Bearer token.

    In development mode (non-production) this is *optional*:
    missing or invalid tokens are silently ignored so the dashboard
    and demo work without authentication.

    In production the token is **required**.
    """
    if creds is None or creds.credentials == "":
        if settings.is_production:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return None  # dev / staging: allow anonymous

    try:
        payload = decode_token(creds.credentials)
        return payload.get("sub")
    except JWTError as exc:
        if settings.is_production:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            )
        logger.warning("Invalid JWT ignored in dev mode: %s", exc)
        return None
