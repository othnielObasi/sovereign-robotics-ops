from __future__ import annotations

import secrets
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl, Field
from typing import List, Optional


def generate_secret() -> str:
    """Generate a secure random token."""
    return secrets.token_hex(32)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ------------------------------------------------------------
    # Server
    # ------------------------------------------------------------
    backend_host: str = "0.0.0.0"
    backend_port: int = 8080
    environment: str = "development"  # development | staging | production

    # ------------------------------------------------------------
    # Database
    # ------------------------------------------------------------
    database_url: str = "sqlite:///./data/app.db"

    # ------------------------------------------------------------
    # Authentication (JWT) - Auto-generated if not set
    # ------------------------------------------------------------
    jwt_secret: str = Field(default_factory=generate_secret)
    jwt_issuer: str = "sro"
    jwt_audience: str = "sro-ui"
    access_token_expire_minutes: int = 720
    jwt_algorithm: str = "HS256"

    # ------------------------------------------------------------
    # Simulator Connection - Auto-generated if not set
    # ------------------------------------------------------------
    sim_base_url: str = "http://localhost:8090"
    sim_token: str = Field(default_factory=generate_secret)
    
    # Gazebo
    gazebo_master_uri: str = "http://localhost:11311"
    
    # Isaac Sim
    isaac_sim_host: str = "localhost"
    isaac_sim_port: int = 8211

    # ------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------
    cors_origins: str = "http://localhost:3000"

    # ------------------------------------------------------------
    # Gemini Robotics 1.5 API
    # ------------------------------------------------------------
    gemini_api_key: Optional[str] = None
    gemini_project_id: Optional[str] = None
    gemini_model: str = "gemini-1.5-pro"
    gemini_timeout_s: float = 30.0
    gemini_enabled: bool = False

    # ------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------
    otel_exporter_endpoint: Optional[str] = None
    otel_service_name: str = "sovereign-robotics-ops"
    sentry_dsn: Optional[str] = None

    # ------------------------------------------------------------
    # Notifications (Optional)
    # ------------------------------------------------------------
    slack_webhook_url: Optional[str] = None
    alert_email: Optional[str] = None

    # ------------------------------------------------------------
    # Governance Settings
    # ------------------------------------------------------------
    risk_threshold: float = 0.70
    audit_chain_enabled: bool = True
    human_safe_distance_m: float = 1.5
    max_speed_near_human: float = 0.3

    @property
    def cors_origins_list(self) -> List[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]
    
    @property
    def is_production(self) -> bool:
        return self.environment == "production"
    
    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_enabled)


settings = Settings()

# Log auto-generated secrets on first run (development only)
if settings.environment == "development":
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"🔑 SIM_TOKEN auto-generated (set SIM_TOKEN env var to override)")
    logger.info(f"🔑 JWT_SECRET auto-generated (set JWT_SECRET env var to override)")
