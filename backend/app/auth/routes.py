from __future__ import annotations

from fastapi import APIRouter
from app.auth.jwt import create_access_token

router = APIRouter()


@router.post("/auth/dev-token")
def dev_token():
    """MVP helper endpoint: returns a dev token.

    In production, replace with real auth.
    """
    return {"access_token": create_access_token("operator"), "token_type": "bearer"}
