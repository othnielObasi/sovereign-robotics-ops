from __future__ import annotations

"""Preflight checks for container startup.

- ensures data directory exists for SQLite
- prints config summary
"""

import os
from app.config import settings


def main():
    os.makedirs("data", exist_ok=True)
    print("Preflight OK")
    print(f"DATABASE_URL={settings.database_url}")
    print(f"SIM_BASE_URL={settings.sim_base_url}")
    print(f"CORS_ORIGINS={settings.cors_origins}")


if __name__ == "__main__":
    main()
