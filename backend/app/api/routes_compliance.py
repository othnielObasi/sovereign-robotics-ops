"""
Compliance API Routes
Endpoints for generating and exporting compliance reports.
"""

from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import PlainTextResponse, JSONResponse

from app.services.compliance_report import compliance_service, ComplianceReport

router = APIRouter(prefix="/compliance", tags=["compliance"])


_demo_events: List[Dict[str, Any]] = [
    {
        "id": "evt-001",
        "timestamp": "2026-02-10T14:30:00Z",
        "action_type": "move",
        "approved": True,
        "risk_score": 0.15,
        "violations": [],
    },
    {
        "id": "evt-002",
        "timestamp": "2026-02-10T14:30:05Z",
        "action_type": "move",
        "approved": True,
        "risk_score": 0.52,
        "violations": [{"policy_id": "speed-limit", "severity": "MEDIUM"}],
    },
    {
        "id": "evt-003",
        "timestamp": "2026-02-10T14:30:10Z",
        "action_type": "move",
        "approved": False,
        "risk_score": 0.85,
        "violations": [
            {"policy_id": "human-presence", "severity": "HIGH"},
            {"policy_id": "speed-limit", "severity": "HIGH"},
        ],
    },
    {
        "id": "evt-004",
        "timestamp": "2026-02-10T14:30:15Z",
        "action_type": "stop",
        "approved": True,
        "risk_score": 0.10,
        "violations": [],
    },
]


def _validate_framework(framework: str) -> None:
    valid_frameworks = ["ISO_42001", "EU_AI_ACT", "NIST_AI_RMF"]
    if framework not in valid_frameworks:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid framework. Must be one of: {valid_frameworks}",
        )


@router.get(
    "/report/{run_id}",
    response_model=ComplianceReport,
    summary="Generate a compliance report (JSON)",
)
async def get_compliance_report(
    run_id: str,
    framework: str = Query("ISO_42001", description="Compliance framework"),
) -> ComplianceReport:
    """
    Generate a compliance report for a specific run (JSON).
    """
    _validate_framework(framework)

    report = compliance_service.generate_report(
        run_id=run_id,
        events=_demo_events,
        framework=framework,
    )
    return report


@router.get(
    "/report/{run_id}.txt",
    response_class=PlainTextResponse,
    summary="Generate a compliance report (plain text)",
)
async def get_compliance_report_text(
    run_id: str,
    framework: str = Query("ISO_42001", description="Compliance framework"),
) -> PlainTextResponse:
    """
    Generate a compliance report for a specific run (plain text summary).
    """
    _validate_framework(framework)

    report = compliance_service.generate_report(
        run_id=run_id,
        events=_demo_events,
        framework=framework,
    )
    summary = compliance_service.export_summary(report)
    return PlainTextResponse(content=summary)


@router.get("/report/{run_id}/export")
async def export_compliance_report(
    run_id: str,
    framework: str = Query("ISO_42001"),
) -> JSONResponse:
    """
    Export compliance report as downloadable JSON.
    """
    _validate_framework(framework)

    report = compliance_service.generate_report(
        run_id=run_id,
        events=_demo_events,
        framework=framework,
    )

    return JSONResponse(
        content=report.model_dump(),
        headers={
            "Content-Disposition": f"attachment; filename=compliance-report-{run_id}.json"
        },
    )


@router.get("/frameworks")
async def list_frameworks():
    return {
        "frameworks": [
            {
                "id": "ISO_42001",
                "name": "ISO/IEC 42001:2023",
                "description": "AI Management System Standard",
            },
            {
                "id": "EU_AI_ACT",
                "name": "EU AI Act",
                "description": "European Union AI Regulation",
            },
            {
                "id": "NIST_AI_RMF",
                "name": "NIST AI RMF",
                "description": "US AI Risk Management Framework",
            },
        ]
    }


@router.get("/verify/{run_id}")
async def verify_audit_chain(run_id: str):
    report = compliance_service.generate_report(
        run_id=run_id,
        events=_demo_events,
    )

    return {
        "run_id": run_id,
        "chain_valid": report.chain_valid,
        "total_entries": len(report.audit_entries),
        "first_hash": report.audit_entries[0].hash[:16] + "..." if report.audit_entries else None,
        "last_hash": report.audit_entries[-1].hash[:16] + "..." if report.audit_entries else None,
        "verified_at": datetime.utcnow().isoformat() + "Z",
    }
