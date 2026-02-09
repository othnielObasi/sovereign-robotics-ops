from __future__ import annotations

import httpx
from typing import Any, Dict, Optional
from app.config import settings


class SimAdapter:
    """Minimal HTTP adapter for the mock simulator.

    The simulator exposes:
      - GET  /telemetry  -> current telemetry JSON
      - POST /command    -> execute a command
      - GET  /world      -> static world definition
    """

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.sim_base_url).rstrip("/")
        self._headers: Dict[str, str] = {}
        if getattr(settings, "sim_token", ""):
            self._headers["X-Sim-Token"] = settings.sim_token
        # Single shared client for all simulator calls
        self._client = httpx.AsyncClient(timeout=5.0, headers=self._headers)



    async def get_world(self) -> Dict[str, Any]:
        r = await self._client.get(f"{self.base_url}/world")
        r.raise_for_status()
        return r.json()

    async def get_telemetry(self) -> Dict[str, Any]:
        r = await self._client.get(f"{self.base_url}/telemetry")
        r.raise_for_status()
        return r.json()

    async def send_command(self, command: Dict[str, Any]) -> Dict[str, Any]:
        r = await self._client.post(f"{self.base_url}/command", json=command)
        r.raise_for_status()
        return r.json()

    async def close(self) -> None:
        await self._client.aclose()
