"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getRun, listEvents, stopRun, getWorld, getPathPreview, triggerScenario, generateLLMPlan, executeLLMPlan } from "@/lib/api";
import { Map2D } from "@/components/Map2D";
import { wsUrlForRun } from "@/lib/ws";
import type { WsMessage } from "@/lib/types";

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-800 border border-slate-700 rounded-xl p-5 ${className}`}>
      <div className="font-bold text-sm text-slate-300 uppercase tracking-wide mb-3">{title}</div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const color = s === "running" ? "bg-green-500/20 text-green-400 border-green-500/30"
    : s === "stopped" ? "bg-red-500/20 text-red-400 border-red-500/30"
    : "bg-slate-700 text-slate-400 border-slate-600";
  return (
    <span className={`text-xs font-medium px-3 py-1 rounded-full border ${color}`}>
      {status || "—"}
    </span>
  );
}

function SafetyBadge({ state, detail }: { state: string; detail: string }) {
  const map: Record<string, string> = {
    OK: "bg-green-500/20 text-green-400 border-green-500/30",
    STOP: "bg-red-500/20 text-red-400 border-red-500/30",
    SLOW: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    REPLAN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  const cls = map[state] || map.OK;
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${cls}`}>
      {state}{state !== "OK" ? ` — ${detail}` : ""}
    </span>
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
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<any>(null);

  // Fix 2: scenario system
  const [scenarioLoading, setScenarioLoading] = useState<string | null>(null);
  const [scenarioToast, setScenarioToast] = useState<string | null>(null);

  // Fix 2: explicit policy_state from WS
  const [livePolicyState, setLivePolicyState] = useState<string>("SAFE");

  // Fix 3: LLM plan
  const [llmInstruction, setLlmInstruction] = useState("");
  const [llmPlan, setLlmPlan] = useState<any>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmExecResult, setLlmExecResult] = useState<any>(null);
  const [llmExecuting, setLlmExecuting] = useState(false);

  async function refreshEvents() {
    try {
      const rows = await listEvents(runId);
      setEvents(rows);
    } catch (_) {}
  }

  useEffect(() => {
    (async () => {
      try { setRun(await getRun(runId)); } catch (_) {}
      try { setWorld(await getWorld()); } catch (_) {}
      await refreshEvents();
    })();
  }, [runId]);

  useEffect(() => {
    let disposed = false;

    function connect() {
      if (disposed) return;
      const url = wsUrlForRun(runId);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        ws.send("hello");
      };

      ws.onmessage = (ev) => {
        const msg: WsMessage = JSON.parse(ev.data);
        if (msg.kind === "telemetry") setTelemetry(msg.data);
        if (msg.kind === "alert") setAlerts((a) => [{ ts: Date.now(), ...msg.data }, ...a].slice(0, 20));
        if (msg.kind === "event") {
          refreshEvents();
          // Extract policy_state from governance decision
          const ps = msg.data?.policy_state || msg.data?.governance?.policy_state;
          if (ps) setLivePolicyState(ps);
        }
        if (msg.kind === "status") setStatus(msg.data.status);
        try { ws.send("ping"); } catch {}
      };

      ws.onerror = () => { setWsConnected(false); };
      ws.onclose = () => {
        setWsConnected(false);
        if (!disposed) {
          // Reconnect after 2 seconds
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer.current);
      try { wsRef.current?.close(); } catch {}
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

  async function onScenario(scenario: string) {
    setScenarioLoading(scenario);
    try {
      await triggerScenario(scenario);
      const labels: Record<string, string> = {
        human_approach: "Human approaching — robot should SLOW",
        human_too_close: "Human too close — robot should STOP",
        path_blocked: "Path blocked — robot should REPLAN",
        clear: "Scenario cleared — back to normal",
      };
      setScenarioToast(labels[scenario] || scenario);
      setTimeout(() => setScenarioToast(null), 4000);
    } catch (e: any) {
      setScenarioToast(`Failed: ${e.message}`);
      setTimeout(() => setScenarioToast(null), 4000);
    } finally {
      setScenarioLoading(null);
    }
  }

  async function onGeneratePlan() {
    if (!llmInstruction.trim()) return;
    setLlmLoading(true);
    setLlmError(null);
    setLlmPlan(null);
    setLlmExecResult(null);
    try {
      const plan = await generateLLMPlan(llmInstruction);
      setLlmPlan(plan);
    } catch (e: any) {
      setLlmError(e.message || "Plan generation failed");
    } finally {
      setLlmLoading(false);
    }
  }

  async function onExecutePlan() {
    if (!llmPlan?.waypoints?.length) return;
    setLlmExecuting(true);
    setLlmError(null);
    setLlmExecResult(null);
    try {
      const result = await executeLLMPlan(
        llmInstruction,
        llmPlan.waypoints,
        llmPlan.rationale || ""
      );
      setLlmExecResult(result);
    } catch (e: any) {
      setLlmError(e.message || "Execution failed");
    } finally {
      setLlmExecuting(false);
    }
  }

  const lastDecision = useMemo(() => {
    const dec = [...events].reverse().find((e) => e.type === "DECISION");
    return dec?.payload || null;
  }, [events]);

  const safety = useMemo(() => {
    const g = lastDecision?.governance;
    const ps = livePolicyState;

    if (ps === "STOP") {
      return { state: "STOP", detail: (g?.reasons?.[0] || "Full stop — safety policy") as string };
    }
    if (ps === "REPLAN") {
      return { state: "REPLAN", detail: (g?.required_action || "Replan required") as string };
    }
    if (ps === "SLOW") {
      return { state: "SLOW", detail: (g?.required_action || "Speed limited by policy") as string };
    }

    return { state: "OK", detail: "Within policy" };
  }, [lastDecision, livePolicyState]);

  const currentStatus = status || run?.status || "—";

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Run: <span className="text-cyan-400 font-mono">{runId}</span>
          </h1>
          {run?.mission_id && (
            <p className="text-sm text-slate-400 mt-1">Mission: {run.mission_id}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
            wsConnected
              ? "bg-green-500/20 text-green-400 border-green-500/30"
              : "bg-red-500/20 text-red-400 border-red-500/30"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400" : "bg-red-400 animate-pulse"}`} />
            {wsConnected ? "Live" : "Reconnecting..."}
          </div>
          <StatusBadge status={currentStatus} />
          <SafetyBadge state={safety.state} detail={safety.detail} />
          {currentStatus !== "stopped" && (
            <button
              onClick={onStop}
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
            >
              Stop Run
            </button>
          )}
        </div>
      </div>

      {/* Top Row: Map + Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title="2D Map (Simulation)">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <label className="text-xs text-slate-400 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} className="accent-cyan-500" />
                Risk heatmap
              </label>
              <label className="text-xs text-slate-400 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} className="accent-cyan-500" />
                Trail
              </label>
            </div>
          </div>
          <Map2D world={world} telemetry={telemetry} pathPoints={pathPoints} planWaypoints={llmPlan?.waypoints || null} showHeatmap={showHeatmap} showTrail={showTrail} safetyState={safety.state} />
          <p className="text-[10px] text-slate-500 mt-2">
            Blue: path preview &bull; Red: obstacles &bull; Orange: human clearance &bull; Green: target &bull; Purple: LLM plan &bull; Black: robot pose &bull; Trail: breadcrumbs
          </p>
        </Card>

        <Card title="Live Telemetry">
          {!telemetry ? (
            <div className="text-slate-500 py-8 text-center">
              <div className="text-3xl mb-2">📡</div>
              Waiting for telemetry&hellip;
            </div>
          ) : (
            <pre className="text-xs text-green-400 bg-slate-900/60 p-4 rounded-lg overflow-x-auto max-h-80 overflow-y-auto font-mono">
{JSON.stringify(telemetry, null, 2)}
            </pre>
          )}
        </Card>
      </div>

      {/* Middle Row: Scenario Triggers + LLM Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Scenario Triggers (Fix 2) */}
        <Card title="Scenario Triggers">
          <p className="text-xs text-slate-500 mb-3">Inject deterministic scenarios to demonstrate governance intervention.</p>
          {scenarioToast && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-sm text-cyan-300 animate-pulse">
              {scenarioToast}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onScenario("human_approach")}
              disabled={!!scenarioLoading || currentStatus === "stopped"}
              className="bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 text-yellow-300 text-sm font-medium px-3 py-2.5 rounded-lg transition disabled:opacity-40"
            >
              {scenarioLoading === "human_approach" ? "..." : "🚶 Human Approach"}
            </button>
            <button
              onClick={() => onScenario("human_too_close")}
              disabled={!!scenarioLoading || currentStatus === "stopped"}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-sm font-medium px-3 py-2.5 rounded-lg transition disabled:opacity-40"
            >
              {scenarioLoading === "human_too_close" ? "..." : "🛑 Human Too Close"}
            </button>
            <button
              onClick={() => onScenario("path_blocked")}
              disabled={!!scenarioLoading || currentStatus === "stopped"}
              className="bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-sm font-medium px-3 py-2.5 rounded-lg transition disabled:opacity-40"
            >
              {scenarioLoading === "path_blocked" ? "..." : "🚧 Path Blocked"}
            </button>
            <button
              onClick={() => onScenario("clear")}
              disabled={!!scenarioLoading || currentStatus === "stopped"}
              className="bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-300 text-sm font-medium px-3 py-2.5 rounded-lg transition disabled:opacity-40"
            >
              {scenarioLoading === "clear" ? "..." : "✅ Clear Scenario"}
            </button>
          </div>
        </Card>

        {/* LLM Plan Panel (Fix 3) */}
        <Card title="Gemini LLM Planner">
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Instruction for the robot</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={llmInstruction}
                  onChange={(e) => setLlmInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onGeneratePlan()}
                  placeholder="Navigate to loading bay avoiding obstacles"
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={onGeneratePlan}
                  disabled={llmLoading || !llmInstruction.trim()}
                  className="bg-purple-500 hover:bg-purple-600 disabled:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
                >
                  {llmLoading ? "Planning..." : "Plan"}
                </button>
              </div>
            </div>

            {llmError && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                {llmError}
              </div>
            )}

            {llmPlan && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    llmPlan.all_approved
                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                      : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                  }`}>
                    {llmPlan.all_approved ? "All Waypoints Approved" : "Some Waypoints Flagged"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {llmPlan.waypoints?.length || 0} waypoints • ~{(llmPlan.estimated_time_s || 0).toFixed(0)}s
                  </span>
                </div>

                <div className="bg-slate-900/60 rounded-lg p-3">
                  <div className="text-xs text-slate-400 mb-1">Rationale</div>
                  <div className="text-sm text-purple-300">{llmPlan.rationale}</div>
                </div>

                <div className="space-y-1.5">
                  {(llmPlan.waypoints || []).map((wp: any, i: number) => {
                    const gov = llmPlan.governance?.[i];
                    const ok = gov?.decision === "APPROVED";
                    return (
                      <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                        ok ? "bg-green-500/10 border border-green-500/20" : "bg-yellow-500/10 border border-yellow-500/20"
                      }`}>
                        <span className="font-bold text-purple-400 w-5 text-center">{i + 1}</span>
                        <span className="text-slate-300">({wp.x.toFixed(1)}, {wp.y.toFixed(1)})</span>
                        <span className="text-slate-500">@{wp.max_speed.toFixed(1)} m/s</span>
                        <span className={`ml-auto font-semibold ${ok ? "text-green-400" : "text-yellow-400"}`}>
                          {gov?.decision || "—"}
                        </span>
                        {gov?.policy_hits?.length > 0 && (
                          <span className="text-slate-500 font-mono">{gov.policy_hits.join(", ")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Execute Plan Button */}
                <button
                  onClick={onExecutePlan}
                  disabled={llmExecuting || currentStatus === "stopped"}
                  className="w-full bg-green-500 hover:bg-green-600 disabled:bg-slate-600 text-white text-sm font-semibold py-2.5 rounded-lg transition mt-2"
                >
                  {llmExecuting ? "Executing..." : "Execute Plan in Simulation"}
                </button>

                {/* Execution Results */}
                {llmExecResult && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        llmExecResult.status === "completed" || llmExecResult.status === "completed_with_warnings"
                          ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : llmExecResult.status === "blocked"
                          ? "bg-red-500/20 text-red-400 border border-red-500/30"
                          : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                      }`}>
                        Execution: {llmExecResult.status === "completed_with_warnings" ? "COMPLETED (WARNINGS)" : llmExecResult.status?.toUpperCase()}
                      </span>
                    </div>

                    {(llmExecResult.steps || []).map((step: any, i: number) => (
                      <div key={i} className={`text-xs p-2 rounded-lg ${
                        step.executed
                          ? "bg-green-500/10 border border-green-500/20"
                          : "bg-red-500/10 border border-red-500/20"
                      }`}>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-purple-400">WP {step.waypoint_index + 1}</span>
                          <span className={step.executed ? "text-green-400" : "text-red-400"}>
                            {step.executed ? "Executed" : "Blocked"}
                          </span>
                          <span className="text-slate-500">{step.governance_decision}</span>
                          <span className={`ml-auto font-mono text-[10px] ${
                            step.policy_state === "SAFE" ? "text-green-400" :
                            step.policy_state === "SLOW" ? "text-yellow-400" :
                            step.policy_state === "STOP" ? "text-red-400" : "text-blue-400"
                          }`}>{step.policy_state}</span>
                        </div>
                      </div>
                    ))}

                    <div className="bg-slate-900/60 rounded-lg p-2 text-xs">
                      <span className="text-slate-500">Audit Hash: </span>
                      <span className="text-cyan-400 font-mono">{llmExecResult.audit_hash?.slice(0, 24)}...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Middle Row: Governance Decision */}
      <div className="mb-4">
        <Card title="Latest Governance Decision">
          {!lastDecision ? (
            <div className="text-slate-500 py-4 text-center">
              <div className="text-3xl mb-2">⏳</div>
              No decision yet&hellip;
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-slate-500 text-xs">Intent</span>
                <div className="font-semibold text-white mt-1">{lastDecision.proposal?.intent || "—"}</div>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Decision</span>
                <div className="mt-1">
                  <span className={`font-semibold ${
                    lastDecision.governance?.decision === "APPROVED" ? "text-green-400" :
                    lastDecision.governance?.decision === "DENIED" ? "text-red-400" : "text-yellow-400"
                  }`}>
                    {lastDecision.governance?.decision || "—"}
                  </span>
                </div>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Policies Hit</span>
                <div className="font-mono text-xs text-slate-300 mt-1">
                  {(lastDecision.governance?.policy_hits || []).join(", ") || "None"}
                </div>
              </div>
              <div>
                <span className="text-slate-500 text-xs">Risk Score</span>
                <div className="font-semibold text-white mt-1">
                  {lastDecision.governance?.risk_score != null
                    ? (lastDecision.governance.risk_score * 100).toFixed(0) + "%"
                    : "—"}
                </div>
              </div>
              {lastDecision.governance?.reasons?.length > 0 && (
                <div className="col-span-full">
                  <span className="text-slate-500 text-xs">Reasons</span>
                  <ul className="mt-1 text-sm text-slate-300 list-disc list-inside space-y-0.5">
                    {lastDecision.governance.reasons.map((r: string, idx: number) => <li key={idx}>{r}</li>)}
                  </ul>
                </div>
              )}
              {lastDecision.governance?.required_action && (
                <div className="col-span-full bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <span className="text-yellow-400 text-xs font-semibold">Required Action</span>
                  <div className="text-sm text-yellow-300 mt-1">{lastDecision.governance.required_action}</div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Row: Alerts + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Alerts">
          {alerts.length === 0 ? (
            <div className="text-slate-500 py-4 text-center">
              <div className="text-3xl mb-2">✅</div>
              No alerts yet.
            </div>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <span className="text-red-400">⚠️</span>
                  <span className="text-slate-300">{a.event || JSON.stringify(a)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Chain-of-Trust Timeline">
          {events.length === 0 ? (
            <div className="text-slate-500 py-4 text-center">
              <div className="text-3xl mb-2">🔗</div>
              No events yet.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-1">
              {events.map((e) => (
                <details key={e.id} className="group border-b border-slate-700/50 pb-2">
                  <summary className="cursor-pointer py-2 flex items-center gap-2 text-sm hover:bg-slate-700/30 rounded px-2 -mx-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      e.type === "DECISION" ? "bg-cyan-400" :
                      e.type === "TELEMETRY" ? "bg-green-400" : "bg-yellow-400"
                    }`} />
                    <span className="text-slate-400 text-xs font-mono">{new Date(e.ts).toLocaleTimeString()}</span>
                    <span className="font-semibold text-xs text-slate-300">{e.type}</span>
                    <span className="text-slate-600 text-xs font-mono ml-auto">{e.hash?.slice(0, 12)}…</span>
                  </summary>
                  <pre className="text-xs text-slate-400 bg-slate-900/60 p-3 rounded-lg overflow-x-auto mt-1 font-mono">
{JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}