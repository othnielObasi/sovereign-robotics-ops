# Submission Metadata

## Basic Information

- Project Title: Sovereign Robotics Ops
- Short Description: A real-time governance layer for autonomous robots that evaluates planned actions against safety policies and produces a tamper-proof decision log.
- Long Description:
  Sovereign Robotics Ops provides a governance layer that intercepts action proposals from an AI planner (Gemini Robotics-ER), evaluates them against configurable safety policies (geofence, human presence, speed limits, collision risk), and emits a cryptographically verifiable decision chain (SHA-256) for auditing and compliance. The stack includes a FastAPI backend, Next.js frontend (operator dashboard), and a mock simulator for testing. The project is packaged for single-VM deployment (Vultr) using `docker-compose.vultr.yml` and includes GitHub Actions to provision and configure VMs safely.
- Technology & Category Tags: Python, FastAPI, Next.js, Docker, Postgres, GitHub Actions, Vultr, Robotics, AI Governance
- Final Submission Video Link (Twitter/X): https://twitter.com/yourhandle/status/REPLACE_WITH_VIDEO_ID

## Cover Image and Presentation

- Cover Image: deploy/cover.png (replace with the project's cover image)
- Video Presentation: deploy/presentation_video.mp4 (or Twitter/X link above)
- Slide Presentation: deploy/slides.pdf

## App Hosting & Code Repository

- Public GitHub Repository: https://github.com/othnielObasi/sovereign-robotics-ops
- Demo Application Platform: Vultr single-VM (docker-compose), or local via Docker Compose
- Application URL: http://<VULTR_VM_IP_OR_HOSTNAME> (replace after provisioning)

## Packaging & Notes for Reviewers

- To create the submission archive (includes optional demo video):

```bash
scripts/package_submission.sh [path/to/sro_demo.mp4]
```

- To run locally for quick review:

```bash
git clone https://github.com/othnielObasi/sovereign-robotics-ops.git
cd sovereign-robotics-ops
docker-compose up -d
# Frontend: http://localhost:3000/demo
# Backend: http://localhost:8080/docs
```

- To deploy on a Vultr VM (example):

```bash
# On the target VM
git clone https://github.com/othnielObasi/sovereign-robotics-ops.git /opt/sovereign-robotics-ops
cd /opt/sovereign-robotics-ops
docker compose -f docker-compose.vultr.yml --env-file /etc/sro/.env up -d --build
```

## Checklist (for submission)

- [ ] Final submission video uploaded to Twitter/X and link inserted above
- [ ] Cover image added to `deploy/cover.png`
- [ ] Slide deck added to `deploy/slides.pdf`
- [ ] Demo video optionally added and packaged via `scripts/package_submission.sh`
- [ ] Application URL inserted above and verified

## Contact

- Maintainer: Othniel Obasi — https://github.com/othnielObasi
