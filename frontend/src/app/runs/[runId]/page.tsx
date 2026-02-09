"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getRun, listEvents, stopRun, getWorld, getPathPreview } from "@/lib/api";
import { Map2D } from "@/components/Map2D";
import { wsUrlForRun } from "@/lib/ws";
import type { WsMessage } from "@/lib/types";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, background: "white" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

export default function RunPage({ params }: { params: { runId: string } }) {
  const runId = params.runId;
  const [run, setRun] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [world, setWorld] = useState<any>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(true);
  const [showTrail, setShowTrail] = useState<boolean>(true);
  const [pathPoints, setPathPoints] = useState<Array<{x:number;y:number}> | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [status, setStatus] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  async function refreshEvents() {
    const rows = await listEvents(runId);
    setEvents(rows);
  }

  useEffect(() => {
    (async () => {
      setRun(await getRun(runId));
      setWorld(await getWorld());
      await refreshEvents();
    })();
  }, [runId]);

  useEffect(() => {
    const url = wsUrlForRun(runId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // send ping to keep WS route's loop alive
      ws.send("hello");
    };

    ws.onmessage = (ev) => {
      const msg: WsMessage = JSON.parse(ev.data);
      if (msg.kind === "telemetry") setTelemetry(msg.data);
      if (msg.kind === "alert") setAlerts((a) => [{ ts: Date.now(), ...msg.data }, ...a].slice(0, 20));
      if (msg.kind === "event") {
        // refresh timeline; for MVP, simplest is to re-fetch stored events
        refreshEvents();
      }
      if (msg.kind === "status") setStatus(msg.data.status);
      // keep connection alive (server expects receives)
      try { ws.send("ping"); } catch {}
    };

    ws.onerror = () => {};
    ws.onclose = () => {};

    return () => {
      try { ws.close(); } catch {}
    };
  }, [runId]);

  useEffect(() => {
    let t: any = null;
    async function tick() {
      try {
        const res = await getPathPreview(runId);
        setPathPoints(res.points || null);
      } catch (_) {}
    }
    tick();
    t = setInterval(tick, 1500);
    return () => { if (t) clearInterval(t); };
  }, [runId]);


  async function onStop() {
    await stopRun(runId);
    setStatus("stopped");
  }

  const lastDecision = useMemo(() => {
    const dec = [...events].reverse().find((e) => e.type === "DECISION");
    return dec?.payload || null;
  }, [events]);

  const safety = useMemo(() => {
    const g = lastDecision?.governance;
    const decision = String(g?.decision || "").toUpperCase();
    const req = String(g?.required_action || "").toLowerCase();

    if (decision === "DENIED") {
      if (req.includes("replan") || req.includes("reroute") || req.includes("detour")) {
        return { state: "REPLAN", detail: g?.required_action || "Replan required" };
      }
      return { state: "STOP", detail: (g?.reasons?.[0] || "Action denied") as string };
    }

    if (req.includes("reduce speed") || req.includes("slow") || req.includes("speed")) {
      return { state: "SLOW", detail: g?.required_action || "Speed limited by policy" };
    }

    return { state: "OK", detail: "Within policy" };
  }, [lastDecision]);


  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>Run: {runId}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#666" }}>Status: {status || run?.status || "—"}</span>
          <button onClick={onStop}>Stop</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Card title="2D Map (Simulation)">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: '#444', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
                Risk heatmap
              </label>
              <label style={{ fontSize: 12, color: '#444', display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} />
                Trail
              </label>
            </div>
            <div style={{ fontSize: 12, padding: '4px 8px', borderRadius: 999, border: '1px solid #eee', background: safety.state === 'STOP' ? '#fff1f2' : safety.state === 'SLOW' ? '#fffbeb' : safety.state === 'REPLAN' ? '#eef2ff' : '#f0fdf4' }}>
              <b>{safety.state}</b>{safety.state !== 'OK' ? ` — ${safety.detail}` : ''}
            </div>
          </div>
          <Map2D world={world} telemetry={telemetry} pathPoints={pathPoints} showHeatmap={showHeatmap} showTrail={showTrail} safetyState={safety.state} />
        </Card>

        <Card title="Live Telemetry">
          {!telemetry ? (
            <div>Waiting for telemetry…</div>
          ) : (
            <pre style={{ margin: 0, fontSize: 12, background: "#fafafa", padding: 8, borderRadius: 8, overflowX: "auto" }}>
{JSON.stringify(telemetry, null, 2)}
            </pre>
          )}
        </Card>

        <Card title="Latest Governance Decision">
          {!lastDecision ? (
            <div>No decision yet…</div>
          ) : (
            <div style={{ fontSize: 13 }}>
              <div><b>Intent:</b> {lastDecision.proposal?.intent}</div>
              <div><b>Decision:</b> {lastDecision.governance?.decision}</div>
              <div><b>Policies:</b> {(lastDecision.governance?.policy_hits || []).join(", ") || "—"}</div>
              <div><b>Reasons:</b>
                <ul>
                  {(lastDecision.governance?.reasons || []).map((r: string, idx: number) => <li key={idx}>{r}</li>)}
                </ul>
              </div>
              {lastDecision.governance?.required_action && (
                <div style={{ background: "#fff7e6", border: "1px solid #ffe0a3", padding: 8, borderRadius: 8 }}>
                  <b>Required action:</b> {lastDecision.governance.required_action}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Card title="Alerts">
          {alerts.length === 0 ? (
            <div>No alerts yet.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {alerts.map((a, i) => <li key={i}>{a.event}</li>)}
            </ul>
          )}
        </Card>

        <Card title="Chain-of-Trust Timeline (Events)">
          {events.length === 0 ? (
            <div>No events yet.</div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {events.map((e) => (
                <div key={e.id} style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 0" }}>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {new Date(e.ts).toLocaleTimeString()} · <b>{e.type}</b> · {e.hash.slice(0, 18)}…
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>View payload</summary>
                    <pre style={{ fontSize: 12, background: "#fafafa", padding: 8, borderRadius: 8, overflowX: "auto" }}>
{JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}