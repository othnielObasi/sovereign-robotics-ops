const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

export function wsUrlForRun(runId: string) {
  const u = new URL(API_BASE);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}/ws/runs/${runId}`;
}
