from __future__ import annotations

"""Preflight checks for container startup.

- ensures data directory exists for SQLite
- prints config summary
"""

import os
from app.config import settings


def main():
    os.makedirs("data", exist_ok=True)
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
