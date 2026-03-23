from __future__ import annotations

"""Preflight checks for container startup.

- ensures data directory exists for SQLite
- optionally applies Alembic migrations
- prints config summary
"""

import os
import subprocess

from app.config import settings


def run_migrations() -> None:
    if not settings.migrate_on_start:
        print("Skipping Alembic migrations")
        return

    print("Running Alembic migrations")
    subprocess.run(["alembic", "upgrade", "head"], check=True)


def main():
    os.makedirs("data", exist_ok=True)
    run_migrations()
    # Mask credentials in DATABASE_URL
    db_url = settings.database_url
    if "@" in db_url:
        # Hide password: show scheme + host only
        parts = db_url.split("@")
        db_url = parts[0].split("://")[0] + "://***@" + parts[-1]
    print("Preflight OK")
    print(f"DATABASE_URL={db_url}")
    print(f"SIM_BASE_URL={settings.sim_base_url}")
    print(f"CORS_ORIGINS={settings.cors_origins}")


if __name__ == "__main__":
    main()
