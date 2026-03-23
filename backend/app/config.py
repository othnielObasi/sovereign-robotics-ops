from __future__ import annotations

import secrets
from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    environment: str = "development"  # development | staging | production (FORCED for demo)

    # ------------------------------------------------------------
    # Database
    # ------------------------------------------------------------
    database_url: str = "sqlite:///./data/app.db"

    # ------------------------------------------------------------
    # Authentication (JWT)
    # ------------------------------------------------------------
    # In production, MUST be set via env var JWT_SECRET
    jwt_secret: str = Field(default_factory=generate_secret)
    jwt_issuer: str = "sro"
    jwt_audience: str = "sro-ui"
    access_token_expire_minutes: int = 720
    jwt_algorithm: str = "HS256"
    auth_required: Optional[bool] = None  # Defaults to True in production, False elsewhere
    allow_dev_tokens: Optional[bool] = None  # Defaults to False in production, True elsewhere

    # ------------------------------------------------------------
    # Simulator Connection
    # ------------------------------------------------------------
    # IMPORTANT:
    # - If sim runs in same machine: http://127.0.0.1:8090
    # - If sim runs on separate Fly machine: set SIM_BASE_URL to a Fly internal address
    sim_base_url: str = "http://127.0.0.1:8090"

    # In production, SHOULD be set via env var SIM_TOKEN
    sim_token: str = Field(default_factory=generate_secret)

    # Gazebo
    gazebo_master_uri: str = "http://localhost:11311"

    # Isaac Sim
    isaac_sim_host: str = "localhost"
    isaac_sim_port: int = 8211

    # ------------------------------------------------------------
    # CORS
    # ------------------------------------------------------------
    # Comma-separated origins, e.g.:
    # "http://localhost:3000,https://gt-audio2texts.vercel.app"
    cors_origins: str = "http://localhost:3000"

    # ------------------------------------------------------------
    # HTTP Security
    # ------------------------------------------------------------
    security_headers_enabled: bool = True
    rate_limit_enabled: Optional[bool] = None  # Defaults to True in production, False elsewhere
    rate_limit_requests_per_minute: int = 300
    api_docs_enabled: Optional[bool] = None  # Defaults to False in production, True elsewhere
    hsts_max_age_seconds: int = 31536000
    run_migrations_on_start: Optional[bool] = None  # Defaults to True in production, False elsewhere

    # ------------------------------------------------------------
    # Gemini Robotics 1.5 API
    # ------------------------------------------------------------
    gemini_api_key: Optional[str] = None
    gemini_project_id: Optional[str] = None
    gemini_model: str = "gemini-robotics-er-1.5-preview"
    gemini_timeout_s: float = 10.0
    gemini_enabled: bool = False

    # ------------------------------------------------------------
    # LLM / Agent Configuration
    # ------------------------------------------------------------
    llm_enabled: bool = False
    llm_provider: str = "gemini"  # gemini | agentic | openai | mock
    # If true, starting a run will fail unless an LLM multi-waypoint plan is produced
    require_llm_plan_at_start: bool = True

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
        return self.environment.lower() == "production"

    @property
    def require_auth(self) -> bool:
        if self.auth_required is not None:
            return self.auth_required
        return self.is_production

    @property
    def dev_tokens_enabled(self) -> bool:
        if self.allow_dev_tokens is not None:
            return self.allow_dev_tokens
        return not self.is_production

    @property
    def rate_limit_active(self) -> bool:
        if self.rate_limit_enabled is not None:
            return self.rate_limit_enabled
        return self.is_production

    @property
    def docs_enabled(self) -> bool:
        if self.api_docs_enabled is not None:
            return self.api_docs_enabled
        return not self.is_production

    @property
    def migrate_on_start(self) -> bool:
        if self.run_migrations_on_start is not None:
            return self.run_migrations_on_start
        return self.is_production

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_enabled)

    def validate_runtime(self) -> None:
        """Fail fast on missing critical config in production."""
        import os
        if self.is_production:
            missing = []
            # Require explicitly-set secrets in production (not auto-generated)
            if not os.environ.get("JWT_SECRET"):
                missing.append("JWT_SECRET")
            if not os.environ.get("SIM_TOKEN"):
                missing.append("SIM_TOKEN")
            if missing:
                raise RuntimeError(
                    f"Missing required environment variables in production: {', '.join(missing)}"
                )



settings = Settings()
print(f"[DEBUG] SRO ENVIRONMENT: {settings.environment}")
settings.validate_runtime()
