const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

export function wsUrlForRun(runId: string) {
  if (typeof window !== "undefined" && !API_BASE) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws/runs/${runId}`;
  }
  const u = new URL(API_BASE);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}/ws/runs/${runId}`;
}
