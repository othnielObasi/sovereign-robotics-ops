from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db.session import engine
from app.services.sim_adapter import SimAdapter

router = APIRouter()
logger = logging.getLogger("app.routes_health")


@router.get("/health")
async def health():
    """Health check endpoint with dependency status."""
    db_ok = False
    sim_ok = False
    sim_error = None

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        logger.warning("Health DB check failed: %s", exc)

    sim = SimAdapter()
    try:
        await sim.get_telemetry()
        sim_ok = True
    except Exception as exc:
        sim_error = str(exc)
        logger.warning("Health simulator check failed: %s", exc)
    finally:
        await sim.close()

    payload = {
        "status": "ok" if db_ok and sim_ok else "degraded",
        "environment": settings.environment,
        "gemini_enabled": settings.gemini_configured,
        "version": "0.1.0",
        "checks": {
            "database": "ok" if db_ok else "error",
            "simulator": "ok" if sim_ok else "error",
        },
    }
    if sim_error:
        payload["checks"]["simulator_detail"] = sim_error

    status_code = 200 if db_ok and sim_ok else 503
    return JSONResponse(status_code=status_code, content=payload)
