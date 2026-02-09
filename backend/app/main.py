from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.observability.logging import configure_logging
from app.db.session import engine, Base
from sqlalchemy import text
from app.api.routes_health import router as health_router
from app.api.routes_missions import router as missions_router
from app.api.routes_runs import router as runs_router
from app.api.routes_governance import router as governance_router
from app.api.routes_sim import router as sim_router
from app.api.routes_ws import router as ws_router, hub
from app.api.routes_compliance import router as compliance_router
from app.auth.routes import router as auth_router
from app.services.run_service import RunService

configure_logging()
logger = logging.getLogger("app")


def init_database(max_retries: int = 5, retry_delay: int = 2):
    """
    Initialize database with retry logic.
    Railway/Fly databases may take a moment to be ready.
    """
    for attempt in range(max_retries):
        try:
            # Test connection
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            
            # Create all tables
            Base.metadata.create_all(bind=engine)
            logger.info("✅ Database initialized successfully")
            return True
            
        except Exception as e:
            logger.warning(f"⚠️ Database connection attempt {attempt + 1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                logger.error("❌ Failed to connect to database after all retries")
                # Don't crash - allow app to start, health check will fail
                return False
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup
    logger.info(f"🚀 Starting Sovereign Robotics Ops API")
    logger.info(f"   Environment: {settings.environment}")
    logger.info(f"   Gemini: {'✅ Enabled' if settings.gemini_configured else '❌ Disabled (using mock)'}")
    
    init_database()
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down...")
    await run_service.sim.close()


app = FastAPI(
    title="Sovereign Robotics Ops API", 
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(missions_router)
app.include_router(runs_router)
app.include_router(governance_router)
app.include_router(sim_router)
app.include_router(ws_router)
app.include_router(compliance_router)

# Initialize RunService and bind broadcaster
run_service = RunService()
run_service.bind_broadcaster(hub.broadcast)

# Inject into routes_runs module (simple shared singleton)
import app.api.routes_runs as routes_runs_module
routes_runs_module.run_svc = run_service
