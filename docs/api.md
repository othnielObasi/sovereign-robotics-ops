# API (MVP)

Base: `http://localhost:8080`

## Missions
- `POST /missions`
- `GET /missions`
- `POST /missions/{mission_id}/start`

## Runs
- `GET /runs/{run_id}`
- `POST /runs/{run_id}/stop`
- `GET /runs/{run_id}/events`

## Policies
- `GET /policies`
- `POST /policies/test`

## WebSocket
- `WS /ws/runs/{run_id}`
Sends JSON messages:
- `telemetry`
- `event`
- `alert`
