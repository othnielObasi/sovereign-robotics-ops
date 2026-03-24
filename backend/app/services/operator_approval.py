from __future__ import annotations

from typing import Dict, Any
from datetime import datetime, timezone

from app.db.session import SessionLocal
from app.db.models import OperatorApproval


def approve(run_id: str, proposal_hash: str, approved_by: str | None = None, notes: str | None = None) -> None:
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        oa = OperatorApproval(
            run_id=run_id,
            proposal_hash=proposal_hash,
            approved_by=approved_by,
            approved_at=now,
            notes=notes,
        )
        db.add(oa)
        db.commit()
    finally:
        db.close()


def revoke(run_id: str, proposal_hash: str) -> None:
    db = SessionLocal()
    try:
        db.query(OperatorApproval).filter(
            OperatorApproval.run_id == run_id,
            OperatorApproval.proposal_hash == proposal_hash,
        ).delete()
        db.commit()
    finally:
        db.close()


def is_approved(run_id: str, proposal_hash: str) -> bool:
    db = SessionLocal()
    try:
        cnt = db.query(OperatorApproval).filter(
            OperatorApproval.run_id == run_id,
            OperatorApproval.proposal_hash == proposal_hash,
        ).count()
        return cnt > 0
    finally:
        db.close()


def list_for_run(run_id: str) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        rows = db.query(OperatorApproval).filter(OperatorApproval.run_id == run_id).all()
        return {r.proposal_hash: {"approved_by": r.approved_by, "approved_at": r.approved_at.isoformat(), "notes": r.notes} for r in rows}
    finally:
        db.close()
