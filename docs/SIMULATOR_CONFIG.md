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
| `/telemetry` | GET | Current robot state |
| `/world` | GET | Map, obstacles, zones |
| `/command` | POST | Send movement commands |

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
