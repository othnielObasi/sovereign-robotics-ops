from __future__ import annotations

import json
from typing import Any, Dict, List
from sqlalchemy.orm import Session

from app.db.models import Mission
from app.schemas.mission import MissionCreate
from app.utils.ids import new_id
from app.utils.time import utc_now


class MissionService:
    def create(self, db: Session, payload: MissionCreate) -> Mission:
        m = Mission(
            id=new_id("mis"),
            title=payload.title,
            goal_json=json.dumps(payload.goal, ensure_ascii=False),
            created_at=utc_now(),
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        return m

    def list(self, db: Session) -> List[Mission]:
        return db.query(Mission).order_by(Mission.created_at.desc()).all()

    def get(self, db: Session, mission_id: str) -> Mission | None:
        return db.query(Mission).filter(Mission.id == mission_id).first()
