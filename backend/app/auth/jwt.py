from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict
from jose import jwt
from app.config import settings
from app.utils.time import utc_now


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
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
