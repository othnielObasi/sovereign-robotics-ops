from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.db.models import Mission, MissionAudit
from app.schemas.mission import MissionCreate, MissionUpdate
from app.utils.ids import new_id
from app.utils.time import utc_now


class MissionService:
    # ── helpers ──────────────────────────────────────────────

    def _audit(
        self,
        db: Session,
        mission_id: str,
        action: str,
        *,
        old_values: Optional[Dict[str, Any]] = None,
        new_values: Optional[Dict[str, Any]] = None,
        details: Optional[str] = None,
        actor: str = "operator",
    ) -> MissionAudit:
        entry = MissionAudit(
            mission_id=mission_id,
            ts=utc_now(),
            action=action,
            actor=actor,
            old_values=json.dumps(old_values, ensure_ascii=False) if old_values else None,
            new_values=json.dumps(new_values, ensure_ascii=False) if new_values else None,
            details=details,
        )
        db.add(entry)
        return entry

    # ── CRUD ─────────────────────────────────────────────────

    def create(self, db: Session, payload: MissionCreate) -> Mission:
        m = Mission(
            id=new_id("mis"),
            title=payload.title,
            goal_json=json.dumps(payload.goal, ensure_ascii=False),
            status="draft",
            created_at=utc_now(),
        )
        db.add(m)
        self._audit(
            db, m.id, "CREATED",
            new_values={"title": m.title, "goal": payload.goal, "status": "draft"},
            details=f"Mission created: {m.title}",
        )
        db.commit()
        db.refresh(m)
        return m

    def update(self, db: Session, mission_id: str, payload: MissionUpdate) -> Mission | None:
        m = self.get(db, mission_id)
        if not m:
            return None
        if m.status not in ("draft", "paused"):
            return None  # can only edit draft or paused missions

        old_vals: Dict[str, Any] = {}
        new_vals: Dict[str, Any] = {}

        if payload.title is not None and payload.title != m.title:
            old_vals["title"] = m.title
            new_vals["title"] = payload.title
            m.title = payload.title

        if payload.goal is not None:
            old_goal = json.loads(m.goal_json)
            if payload.goal != old_goal:
                old_vals["goal"] = old_goal
                new_vals["goal"] = payload.goal
                m.goal_json = json.dumps(payload.goal, ensure_ascii=False)

        if new_vals:
            m.updated_at = utc_now()
            changes = ", ".join(new_vals.keys())
            self._audit(
                db, m.id, "UPDATED",
                old_values=old_vals,
                new_values=new_vals,
                details=f"Updated: {changes}",
            )
            db.commit()
            db.refresh(m)
        return m

    def set_status(
        self, db: Session, mission_id: str, new_status: str,
        *, details: Optional[str] = None, actor: str = "operator",
    ) -> Mission | None:
        m = self.get(db, mission_id)
        if not m:
            return None
        old_status = m.status
        m.status = new_status
        m.updated_at = utc_now()
        self._audit(
            db, m.id, "STATUS_CHANGE",
            old_values={"status": old_status},
            new_values={"status": new_status},
            details=details or f"Status: {old_status} → {new_status}",
            actor=actor,
        )
        db.commit()
        db.refresh(m)
        return m

    def soft_delete(self, db: Session, mission_id: str) -> Mission | None:
        return self.set_status(db, mission_id, "deleted", details="Mission soft-deleted")

    def replay(self, db: Session, mission_id: str) -> Mission | None:
        """Reset a completed/failed mission back to draft so it can be re-executed."""
        m = self.get(db, mission_id)
        if not m:
            return None
        if m.status not in ("completed", "failed", "paused"):
            return None
        old_status = m.status
        m.status = "draft"
        m.updated_at = utc_now()
        self._audit(
            db, m.id, "REPLAYED",
            old_values={"status": old_status},
            new_values={"status": "draft"},
            details=f"Mission replayed from {old_status}",
        )
        db.commit()
        db.refresh(m)
        return m

    def list(
        self, db: Session, limit: int = 50, offset: int = 0,
        include_deleted: bool = False,
    ) -> List[Mission]:
        q = db.query(Mission)
        if not include_deleted:
            q = q.filter(Mission.status != "deleted")
        return q.order_by(Mission.created_at.desc()).offset(offset).limit(limit).all()

    def get(self, db: Session, mission_id: str) -> Mission | None:
        return db.query(Mission).filter(Mission.id == mission_id).first()

    def get_audit_trail(
        self, db: Session, mission_id: Optional[str] = None,
        limit: int = 100, offset: int = 0,
    ) -> List[MissionAudit]:
        q = db.query(MissionAudit)
        if mission_id:
            q = q.filter(MissionAudit.mission_id == mission_id)
        return q.order_by(MissionAudit.ts.desc()).offset(offset).limit(limit).all()
