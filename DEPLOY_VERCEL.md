# Vercel Deployment Guide

## Prereqs
- Vercel account
- Frontend is in `frontend/` folder

## Steps

1. In Vercel dashboard → New Project → Import from GitHub
2. Set project root to:
```
frontend
```
3. Environment variables:
```
NEXT_PUBLIC_API_BASE=https://sro-ops.fly.dev
```
4. Hit Deploy.

That's it. After deploy, update CORS_ORIGINS on Fly with your Vercel URL.
