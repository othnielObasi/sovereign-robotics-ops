const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

async function parseErrorResponse(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json();
    if (body.detail) return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    return fallback;
  } catch {
    return fallback;
  }
}

export async function listMissions() {
  const r = await fetch(`${API_BASE}/missions`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to list missions"));
  return r.json();
}

export async function createMission(payload: any) {
  const r = await fetch(`${API_BASE}/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to create mission"));
  return r.json();
}

export async function updateMission(missionId: string, payload: { title?: string; goal?: any }) {
  const r = await fetch(`${API_BASE}/missions/${missionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to update mission"));
  return r.json();
}

export async function deleteMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to delete mission"));
  return r.json();
}

export async function pauseMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/pause`, { method: "POST" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to pause mission"));
  return r.json();
}

export async function resumeMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/resume`, { method: "POST" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to resume mission"));
  return r.json();
}

export async function startRun(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/start`, { method: "POST" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to start run"));
  return r.json();
}

export async function listRuns(missionId?: string) {
  const params = missionId ? `?mission_id=${missionId}&limit=1` : '';
  const r = await fetch(`${API_BASE}/runs${params}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to list runs"));
  return r.json();
}

export async function getRun(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get run"));
  return r.json();
}

export async function listEvents(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/events`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to list events"));
  return r.json();
}

export async function stopRun(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/stop`, { method: "POST" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to stop run"));
  return r.json();
}

export async function listPolicies() {
  const r = await fetch(`${API_BASE}/policies`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to list policies"));
  return r.json();
}

export async function testPolicy(payload: any) {
  const r = await fetch(`${API_BASE}/policies/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to test policy"));
  return r.json();
}


export async function getWorld() {
  const r = await fetch(`${API_BASE}/sim/world`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get world"));
  return r.json();
}

export async function getPathPreview(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/path_preview`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get path preview"));
  return r.json();
}

export async function getMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get mission"));
  return r.json();
}

export async function triggerScenario(scenario: string) {
  const r = await fetch(`${API_BASE}/sim/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to trigger scenario"));
  return r.json();
}

// ---- LLM: Models ----

export async function listLLMModels() {
  const r = await fetch(`${API_BASE}/llm/models`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to list models"));
  return r.json();
}

export async function generateLLMPlan(instruction: string, goal?: { x: number; y: number }, model?: string) {
  const r = await fetch(`${API_BASE}/llm/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, goal: goal || null, model: model || null }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to generate LLM plan"));
  return r.json();
}

export async function executeLLMPlan(
  instruction: string,
  waypoints: Array<{ x: number; y: number; max_speed: number }>,
  rationale: string = ""
) {
  const r = await fetch(`${API_BASE}/llm/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction, waypoints, rationale }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to execute LLM plan"));
  return r.json();
}

// ---- LLM: Telemetry Analysis ----

export async function analyzeTelemetry(events: any[], question?: string, model?: string) {
  const r = await fetch(`${API_BASE}/llm/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events, question: question || null, model: model || null }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to analyze telemetry"));
  return r.json();
}

// ---- LLM: Scene Analysis (Multimodal) ----

export async function analyzeScene(sceneDescription: string, includeTelemetry: boolean = true, model?: string) {
  const r = await fetch(`${API_BASE}/llm/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene_description: sceneDescription, include_telemetry: includeTelemetry, model: model || null }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to analyze scene"));
  return r.json();
}

// ---- LLM: Failure Detection ----

export async function detectFailures(events: any[], model?: string) {
  const r = await fetch(`${API_BASE}/llm/failure-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events, model: model || null }),
  });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to detect failures"));
  return r.json();
}

// ---- Replay & Audit ----

export async function replayMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/replay`, { method: "POST" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to replay mission"));
  return r.json();
}

export async function getMissionAudit(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/audit`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get mission audit"));
  return r.json();
}

export async function getAllAudit(limit = 100, offset = 0) {
  const r = await fetch(`${API_BASE}/audit/missions?limit=${limit}&offset=${offset}`, { cache: "no-store" });
  if (!r.ok) throw new Error(await parseErrorResponse(r, "Failed to get audit trail"));
  return r.json();
}
