# Fly.io (sidecar) deployment

This repo is set up to run **backend + simulator on the same Fly machine**:
- `api` process: FastAPI (public) on port 8080
- `sim` process: mock simulator (private) on `127.0.0.1:8090`

## Prereqs
- Fly CLI installed
- Railway Postgres provisioned

## Login
```bash
fly auth login
```

## Create app (one-time)
From repo root:
```bash
fly launch --no-deploy
```
> If you want a different region, edit `primary_region` in `fly.toml`.

## Set secrets
```bash
fly secrets set DATABASE_URL="YOUR_RAILWAY_DATABASE_URL"
fly secrets set CORS_ORIGINS="https://YOUR_VERCEL_APP.vercel.app"
fly secrets set SIM_TOKEN="some-long-random"   # optional (sim is localhost-only)
```

Optional (LLM):
```bash
fly secrets set LLM_ENABLED="true"
fly secrets set LLM_PROVIDER="gemini"
fly secrets set GEMINI_API_KEY="..."
fly secrets set GEMINI_MODEL="gemini-robotics-er-1.5-preview"
```

## Deploy
```bash
fly deploy
```

## Verify
- API docs: `https://<app>.fly.dev/docs`
- Health: `https://<app>.fly.dev/health`
