const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "/api";

export function wsUrlForRun(runId: string) {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/runs/${runId}`;
  }
  return `/ws/runs/${runId}`;
}
