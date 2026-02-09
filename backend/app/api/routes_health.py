from __future__ import annotations

from fastapi import APIRouter
from app.config import settings

router = APIRouter()


@router.get("/health")
def health():
    """Health check endpoint with system status."""
    return {
        "status": "ok",
        "environment": settings.environment,
        "gemini_enabled": settings.gemini_configured,
        "version": "0.1.0"
    }
