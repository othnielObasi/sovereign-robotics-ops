const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

export async function listMissions() {
  const r = await fetch(`${API_BASE}/missions`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to list missions");
  return r.json();
}

export async function createMission(payload: any) {
  const r = await fetch(`${API_BASE}/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to create mission");
  return r.json();
}

export async function startRun(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}/start`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to start run");
  return r.json();
}

export async function getRun(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to get run");
  return r.json();
}

export async function listEvents(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/events`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to list events");
  return r.json();
}

export async function stopRun(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/stop`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to stop run");
  return r.json();
}

export async function listPolicies() {
  const r = await fetch(`${API_BASE}/policies`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to list policies");
  return r.json();
}

export async function testPolicy(payload: any) {
  const r = await fetch(`${API_BASE}/policies/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("Failed to test policy");
  return r.json();
}


export async function getWorld() {
  const r = await fetch(`${API_BASE}/sim/world`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to get world");
  return r.json();
}

export async function getPathPreview(runId: string) {
  const r = await fetch(`${API_BASE}/runs/${runId}/path_preview`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to get path preview");
  return r.json();
}

export async function getMission(missionId: string) {
  const r = await fetch(`${API_BASE}/missions/${missionId}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to get mission");
  return r.json();
}
