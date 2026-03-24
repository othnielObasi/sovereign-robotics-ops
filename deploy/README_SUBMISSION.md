# Submission package

This package contains the files needed to build and run the Sovereign Robotics Ops demo for review.

Contents included by `scripts/package_submission.sh`:
- `frontend/` and `backend/` source
- `docker-compose.vultr.yml`, `Dockerfile.fly`, `fly.toml`
- `README.md` (project overview)
- `scripts/record_demo.js` (Playwright recorder)
- Optional: `frontend/public/downloads/sro_demo.mp4` (if provided)

Quick reviewer steps
1. Extract the archive:

```bash
tar -xzf submission-<timestamp>.tar.gz
cd submission-<timestamp>
```

2. (Optional) If the MP4 is not included, place the demo video at `frontend/public/downloads/sro_demo.mp4`.

3. Build and run with Docker Compose:

```bash
docker compose -f docker-compose.vultr.yml up --build -d
```

4. The frontend will be available on port 3000 by default (or 80 if the compose file maps it). The demo page is `/demo` and the direct download should be `/downloads/sro_demo.mp4`.

5. Run backend tests (optional):

```bash
cd backend
pytest tests/
```

Notes
- If your environment requires a host webserver for static files (e.g., nginx), place `sro_demo.mp4` in the server's webroot under `/downloads/` or use the frontend `public/downloads` path as above.
- For the Isaac Sim integration and high-fidelity recordings, see the top-level `docs/GEMINI_INTEGRATION.md` and follow-up tasks in the project TODO.
