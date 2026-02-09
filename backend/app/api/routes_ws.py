from __future__ import annotations

import asyncio
import json
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


class WsHub:
    def __init__(self):
        self._clients: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, run_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.setdefault(run_id, set()).add(ws)

    async def disconnect(self, run_id: str, ws: WebSocket) -> None:
        async with self._lock:
            if run_id in self._clients and ws in self._clients[run_id]:
                self._clients[run_id].remove(ws)
                if not self._clients[run_id]:
                    self._clients.pop(run_id, None)

    async def broadcast(self, run_id: str, message: dict) -> None:
        # Copy references to avoid mutation while iterating
        async with self._lock:
            clients = list(self._clients.get(run_id, set()))
        if not clients:
            return

        payload = json.dumps(message, ensure_ascii=False)
        dead = []
        for ws in clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        # Clean dead sockets
        for ws in dead:
            await self.disconnect(run_id, ws)


hub = WsHub()


@router.websocket("/ws/runs/{run_id}")
async def ws_run(run_id: str, ws: WebSocket):
    await hub.connect(run_id, ws)
    try:
        while True:
            # Keep connection open; accept pings/messages if sent by client
            _ = await ws.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(run_id, ws)
    except Exception:
        await hub.disconnect(run_id, ws)
