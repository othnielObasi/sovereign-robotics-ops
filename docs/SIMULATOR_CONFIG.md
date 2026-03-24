# Simulator Configuration Guide

## Overview

The **SIM_TOKEN** and **SIM_BASE_URL** connect your backend to the robot simulator.

```
┌─────────────────┐                    ┌─────────────────┐
│    BACKEND      │  ──HTTP + TOKEN──▶ │   SIMULATOR     │
│   (FastAPI)     │                    │  (Mock/Gazebo)  │
│   Port 8080     │  ◀──Telemetry───   │   Port 8090     │
└─────────────────┘                    └─────────────────┘
```

## Configuration

### 1. SIM_BASE_URL

Where the simulator is running.

| Environment | Value |
|-------------|-------|
| Local (Docker) | `http://localhost:8090` |
| Local (same machine) | `http://localhost:8090` |
| Docker Compose | `http://sim:8090` |
| Remote server | `http://your-sim-server:8090` |

### 2. SIM_TOKEN

A shared secret that authenticates backend → simulator requests.

#### Generate a Token:
```bash
# Method 1: OpenSSL
openssl rand -hex 16
# Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Method 2: Python
python -c "import secrets; print(secrets.token_hex(16))"

# Method 3: UUID
python -c "import uuid; print(uuid.uuid4().hex)"
```

#### Set the Same Token in Both Places:

**Backend (.env):**
```env
SIM_BASE_URL=http://localhost:8090
SIM_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Simulator (environment):**
```bash
# When running mock simulator
export SIM_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
python server.py

# Or in docker-compose.yml
services:
  sim:
    environment:
      - SIM_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

## How It Works

1. **Backend** makes request to simulator:
   ```
   GET http://localhost:8090/telemetry
   Headers:
     X-Sim-Token: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
   ```

2. **Simulator** checks the token:
   ```python
   if request.headers["X-Sim-Token"] != SIM_TOKEN:
       return 401 Unauthorized
   ```

3. **If valid**, simulator returns data:
   ```json
   {
     "x": 5.2,
     "y": 3.1,
     "speed": 0.5,
     "human_detected": true
   }
   ```

## Scenarios

### Local Development (No Token)

Simplest setup - no authentication:

```env
# Backend .env
SIM_BASE_URL=http://localhost:8090
SIM_TOKEN=
```

```bash
# Run simulator without token
cd sim/mock_sim
uvicorn server:app --port 8090
```

### Docker Compose (With Token)

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    environment:
      - SIM_BASE_URL=http://sim:8090
      - SIM_TOKEN=${SIM_TOKEN}
    ports:
      - "8080:8080"
  
  sim:
    build: ./sim/mock_sim
    environment:
      - SIM_TOKEN=${SIM_TOKEN}
    ports:
      - "8090:8090"
```

```bash
# .env file (shared)
SIM_TOKEN=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Production (Fly.io + External Sim)

```bash
# Set on Fly.io
fly secrets set SIM_BASE_URL=https://your-sim.example.com
fly secrets set SIM_TOKEN=your_production_token
```

### GitHub Actions

```yaml
# In deploy.yml
- name: Deploy to Fly.io
  run: |
    flyctl secrets set \
      SIM_BASE_URL="${{ secrets.SIM_BASE_URL }}" \
      SIM_TOKEN="${{ secrets.SIM_TOKEN }}"
```

## Without a Real Simulator

If you don't have a simulator running:

1. **Demo still works** - The dashboard uses mock data
2. **Gemini adapter works** - Falls back to mock planning
3. **Governance works** - Evaluates any input

The SIM connection is only needed for:
- Real-time robot telemetry
- Sending commands to actual robot
- Gazebo/Isaac Sim integration

## Simulator Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/telemetry` | GET | Current robot state + perception |
| `/world` | GET | Map, obstacles, zones, bays |
| `/command` | POST | Send movement commands (MOVE_TO, STOP, WAIT) |
| `/scenario` | POST | Inject a test scenario |
| `/scenarios` | GET | List all scenarios with metadata |
| `/scenarios/sequences` | GET | List scripted scenario sequences |
| `/scenarios/sequences/{id}` | GET | Get steps for a specific sequence |

## World Configuration

The simulator loads `world.json` which defines the warehouse layout:

| Zone | Y Range | Speed Limit | Description |
|------|---------|-------------|-------------|
| `aisle` | 0–12 | 0.5 m/s | Shelf aisles with pedestrian traffic |
| `corridor` | 12–15 | 0.7 m/s | Transit corridor between zones |
| `loading_bay` | 15–25 | 0.4 m/s | Dock area with forklifts and workers |

Geofence: 40 m × 25 m (x: 0–40, y: 0–25)

## Scenario Injection

Inject deterministic scenarios to test governance policies:

```bash
# Place human ~2.5m ahead (triggers SLOW)
curl -X POST http://localhost:8090/scenario \
  -H "Content-Type: application/json" \
  -d '{"scenario": "human_approach"}'

# Reset to defaults
curl -X POST http://localhost:8090/scenario \
  -H "Content-Type: application/json" \
  -d '{"scenario": "clear"}'
```

### Available Scenarios

| Scenario | Policies Exercised | Expected State |
|----------|-------------------|----------------|
| `human_approach` | HUMAN_PROXIMITY_02 | SLOW |
| `human_too_close` | HUMAN_PROXIMITY_02 | STOP |
| `path_blocked` | OBSTACLE_CLEARANCE_03 | REPLAN |
| `speed_violation` | SAFE_SPEED_01 | SLOW |
| `geofence_breach` | GEOFENCE_01 | STOP |
| `low_confidence` | UNCERTAINTY_04, HUMAN_PROXIMITY_02 | SLOW |
| `multi_worker_congestion` | WORKER_PROXIMITY_06 | STOP |
| `loading_bay_rush` | SAFE_SPEED_01, WORKER_PROXIMITY_06, OBSTACLE_CLEARANCE_03 | STOP |
| `corridor_squeeze` | OBSTACLE_CLEARANCE_03, HUMAN_PROXIMITY_02 | STOP |
| `clear` | — | SAFE (reset) |

Injected scenarios hold for ~5 seconds before ambient walking behaviour resumes.

## Scripted Sequences

Pre-built scenario sequences for demos and testing:

```bash
# List available sequences
curl http://localhost:8090/scenarios/sequences

# Get the governance demo sequence (5 steps)
curl http://localhost:8090/scenarios/sequences/governance_demo
```

| Sequence | Steps | Purpose |
|----------|-------|---------|
| `governance_demo` | 5 | Core governance reactions: clear → approach → stop → blocked → clear |
| `policy_sweep` | 11 | Exercise every policy in the catalog sequentially |
| `stress_test` | 7 | Rapidly trigger compound policy violations |

Each step includes `scenario`, `hold_seconds`, and `narration` fields.  
The caller is responsible for timing — inject each scenario, wait `hold_seconds`, then advance.

## Troubleshooting

### "Connection refused"
- Simulator not running
- Wrong SIM_BASE_URL

### "401 Unauthorized"
- Token mismatch between backend and simulator
- Check both have EXACT same token

### "Timeout"
- Simulator is slow or overloaded
- Network issues between backend and simulator
