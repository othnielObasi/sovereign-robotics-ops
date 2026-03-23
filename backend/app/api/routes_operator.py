from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.services import operator_approval as approval_svc
from app.utils.hashing import sha256_canonical
from app.auth.jwt import get_current_user

router = APIRouter(prefix="/operator", tags=["operator"])


class ApproveRequest(BaseModel):
    run_id: str
    proposal: dict


@router.post("/approve")
def approve(req: ApproveRequest, current_user: str | None = Depends(get_current_user)):
    # Require an authenticated operator in production; in dev, allow if token absent
    if current_user is None:
        raise HTTPException(status_code=403, detail="Operator authentication required")
    if current_user != "operator":
        raise HTTPException(status_code=403, detail="Insufficient role")
    try:
        # Compute stable hash for the provided proposal payload
        ph = sha256_canonical({"proposal": req.proposal})
        approval_svc.approve(req.run_id, ph, approved_by=current_user)
        return {"ok": True, "run_id": req.run_id, "proposal_hash": ph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/approvals/{run_id}")
def list_approvals(run_id: str, current_user: str | None = Depends(get_current_user)):
    if current_user is None:
        raise HTTPException(status_code=403, detail="Operator authentication required")
    if current_user != "operator":
        raise HTTPException(status_code=403, detail="Insufficient role")
    return {"run_id": run_id, "approvals": approval_svc.list_for_run(run_id)}

