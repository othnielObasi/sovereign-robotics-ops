# Pilot Use Cases

## 1. Warehouse AMR Safety Compliance

**Operator:** 3PL warehouse running 10-50 AMRs for goods-to-person picking

**Problem:** Insurer requires proof that robots cannot endanger workers. Current setup: robots have emergency stop buttons, but no continuous compliance evidence.

**Sovereign solves:**
- Real-time geofence enforcement prevents robots from entering restricted zones
- Human proximity policies enforce SLOW/STOP automatically when workers are nearby
- Every action + decision hash-chained → downloadable compliance report for insurer
- Operator dashboard shows live safety state for all missions

**Compliance frameworks:** ISO 42001 (AI management), internal safety operations manual

**Deployment:** Sovereign API runs alongside existing fleet management system. Robot planner calls `/governance/evaluate` before each move command. Dashboard deployed for safety officers.

---

## 2. EU AI Act Readiness for Robotics OEM

**Operator:** European robotics manufacturer shipping AMRs to regulated markets

**Problem:** EU AI Act (enforcement 2026) requires high-risk AI systems to have: risk management, human oversight, logging, transparency. OEM needs to demonstrate this to customers.

**Sovereign solves:**
- Policy engine = risk management system (configurable, auditable)
- HITL escalation = human oversight (automatic trigger on high-risk actions)
- Hash-chained event log = logging with integrity verification
- Governance receipts = transparency (why each action was allowed/blocked)
- Compliance report maps decisions to EU AI Act Articles 9-15

**Compliance frameworks:** EU AI Act, ISO 42001

**Deployment:** Sovereign shipped as embedded middleware in OEM's robot software stack. Each robot evaluates locally; audit data syncs to central compliance dashboard.

---

## 3. Construction Site Autonomous Equipment

**Operator:** General contractor using autonomous earthmovers and surveying drones

**Problem:** Construction sites have unpredictable human presence. Equipment must stop immediately when workers enter operating zones. Current solution: manual spotters and kill switches.

**Sovereign solves:**
- Human detection policies with distance-based escalation (SLOW at 3m, STOP at 1m)
- Speed limit enforcement per zone (different limits near scaffolding vs. open areas)
- Uncertainty policy: if sensor confidence drops below threshold, equipment pauses
- Full audit trail for incident investigation and regulatory reporting

**Compliance frameworks:** OSHA autonomous equipment regulations, site safety plans

**Deployment:** Sovereign runs on edge compute alongside equipment control system. Geofence boundaries configured per site layout.

---

## 4. Last-Mile Delivery Robot Fleet

**Operator:** Sidewalk delivery robot company operating in mixed pedestrian environments

**Problem:** Delivery robots share space with pedestrians, cyclists, and vehicles. Municipalities require proof of safe operation for permits. Incidents = permit revocation.

**Sovereign solves:**
- Pedestrian proximity policies with zone-aware speed limits (school zones, crosswalks)
- Geofence enforcement prevents robots from entering banned areas
- Every decision logged with GPS context → exportable compliance reports for city regulators
- Governance receipts: when a resident complains about robot behavior, operator can pull exact decision + context

**Compliance frameworks:** Municipal robotics permits, NIST AI RMF

**Deployment:** Sovereign cloud API; each robot calls governance API before executing navigation commands.

---

## 5. Defense / Security Patrol Robots

**Operator:** Security company deploying autonomous patrol robots at facilities

**Problem:** Patrol robots must follow strict rules of engagement: never approach within X meters of a person without authorization, restrict access to certain areas after hours, escalate to human operator for any unusual situation.

**Sovereign solves:**
- Policy engine enforces rules of engagement at runtime (not just in training)
- Multi-level escalation: autonomous → supervisory → human operator
- Complete audit trail for every patrol decision (critical for incident review)
- Operator override capability with full audit logging

**Compliance frameworks:** Facility security protocols, client SLAs

**Deployment:** On-premise deployment; no cloud dependency. All governance decisions stored locally.

---

## Priority Ranking

| Use Case | Market Size | Regulatory Urgency | Technical Fit | Priority |
|---|---|---|---|---|
| Warehouse AMR compliance | Large | High (EU AI Act) | Excellent | **#1** |
| EU AI Act OEM readiness | Large | Critical (2026) | Excellent | **#2** |
| Construction autonomous equipment | Medium | Medium (OSHA) | Good | #3 |
| Last-mile delivery | Medium | High (permits) | Good | #4 |
| Defense/security patrol | Small | Low | Good | #5 |
