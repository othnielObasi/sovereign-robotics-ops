from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.db.models import Mission
from app.schemas.mission import MissionCreate, MissionUpdate
from app.utils.ids import new_id
from app.utils.time import utc_now


class MissionService:
    def create(self, db: Session, payload: MissionCreate) -> Mission:
        m = Mission(
            id=new_id("mis"),
            title=payload.title,
            goal_json=json.dumps(payload.goal, ensure_ascii=False),
            status="draft",
            created_at=utc_now(),
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return m

    def update(self, db: Session, mission_id: str, payload: MissionUpdate) -> Mission | None:
        m = self.get(db, mission_id)
        if not m:
            return None
        if m.status not in ("draft", "paused"):
            return None  # can only edit draft or paused missions
        if payload.title is not None:
            m.title = payload.title
        if payload.goal is not None:
            m.goal_json = json.dumps(payload.goal, ensure_ascii=False)
        m.updated_at = utc_now()
        db.commit()
        db.refresh(m)
        return m

    def set_status(self, db: Session, mission_id: str, new_status: str) -> Mission | None:
        m = self.get(db, mission_id)
        if not m:
            return None
        m.status = new_status
        m.updated_at = utc_now()
        db.commit()
        db.refresh(m)
        return m

    def soft_delete(self, db: Session, mission_id: str) -> Mission | None:
        return self.set_status(db, mission_id, "deleted")

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
