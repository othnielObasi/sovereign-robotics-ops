"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getRun, listEvents, stopRun, getWorld, getPathPreview, triggerScenario, generateLLMPlan, executeLLMPlan, analyzeScene, analyzeTelemetry, detectFailures, agenticPropose } from "@/lib/api";
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

  // AI Vision / Multimodal
  const [sceneResult, setSceneResult] = useState<any>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);

  // Telemetry Analysis
  const [telAnalysis, setTelAnalysis] = useState<any>(null);
  const [telAnalysisLoading, setTelAnalysisLoading] = useState(false);
  const [telAnalysisError, setTelAnalysisError] = useState<string | null>(null);

  // Failure Detection
  const [failureResult, setFailureResult] = useState<any>(null);
  const [failureLoading, setFailureLoading] = useState(false);
  const [failureError, setFailureError] = useState<string | null>(null);

  // Agentic Planner
  const [agenticInstruction, setAgenticInstruction] = useState("");
  const [agenticResult, setAgenticResult] = useState<any>(null);
  const [agenticLoading, setAgenticLoading] = useState(false);
  const [agenticError, setAgenticError] = useState<string | null>(null);
  // Live agentic reasoning from WebSocket
  const [liveThoughtChain, setLiveThoughtChain] = useState<any[]>([]);

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
        if (msg.kind === "agent_reasoning") setLiveThoughtChain(msg.data?.steps || []);
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

  /* ── Build a scene description from live world state ────── */
  function buildSceneDescription(): string {
    const lines: string[] = [];
    lines.push("Warehouse environment, 30m x 20m.");
    if (telemetry) {
      lines.push(`Robot at (${(+(telemetry.x ?? 0)).toFixed(1)}, ${(+(telemetry.y ?? 0)).toFixed(1)}) moving at ${(+(telemetry.speed ?? 0)).toFixed(2)} m/s.`);
    }
    if (world?.human) {
      lines.push(`Human detected at (${world.human.x}, ${world.human.y}).`);
      if (telemetry) {
        const dx = +(telemetry.x ?? 0) - +world.human.x;
        const dy = +(telemetry.y ?? 0) - +world.human.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        lines.push(`Distance robot-to-human: ${d.toFixed(1)}m.`);
      }
    }
    if (world?.obstacles?.length) {
      lines.push(`${world.obstacles.length} obstacles: ` + world.obstacles.map((o: any) => `(${o.x}, ${o.y})`).join(", ") + ".");
    }
    if (world?.zones?.length) {
      lines.push("Zones: " + world.zones.map((z: any) => z.name).join(", ") + ".");
    }
    lines.push(`Safety state: ${safety.state}.`);
    return lines.join(" ");
  }

  async function onAnalyzeScene() {
    setSceneLoading(true);
    setSceneError(null);
    setSceneResult(null);
    try {
      const desc = buildSceneDescription();
      const result = await analyzeScene(desc, true);
      setSceneResult(result);
    } catch (e: any) {
      setSceneError(e.message || "Scene analysis failed");
    } finally {
      setSceneLoading(false);
    }
  }

  async function onAnalyzeTelemetry() {
    setTelAnalysisLoading(true);
    setTelAnalysisError(null);
    setTelAnalysis(null);
    try {
      const recentEvents = events.slice(-10);
      const result = await analyzeTelemetry(recentEvents, "Analyze safety trends, anomalies, and recommend actions.");
      setTelAnalysis(result);
    } catch (e: any) {
      setTelAnalysisError(e.message || "Telemetry analysis failed");
    } finally {
      setTelAnalysisLoading(false);
    }
  }

  async function onDetectFailures() {
    setFailureLoading(true);
    setFailureError(null);
    setFailureResult(null);
    try {
      const recentEvents = events.slice(-15);
      const result = await detectFailures(recentEvents);
      setFailureResult(result);
    } catch (e: any) {
      setFailureError(e.message || "Failure detection failed");
    } finally {
      setFailureLoading(false);
    }
  }

  async function onAgenticPropose() {
    if (!agenticInstruction.trim()) return;
    setAgenticLoading(true);
    setAgenticError(null);
    setAgenticResult(null);
    try {
      const result = await agenticPropose(agenticInstruction);
      setAgenticResult(result);
    } catch (e: any) {
      setAgenticError(e.message || "Agentic proposal failed");
    } finally {
      setAgenticLoading(false);
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
            Scroll to zoom &bull; Drag to pan &bull; Cyan: robot &bull; Red: obstacles &bull; Orange: human &bull; Purple: LLM plan &bull; Green: target
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

      {/* AI Vision & Multimodal Analysis (Gemini Robotics ER) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* Scene Analysis (Multimodal) */}
        <Card title="🔍 AI Scene Analysis" className="lg:col-span-1">
          <p className="text-xs text-slate-500 mb-3">
            Gemini Robotics ER multimodal analysis of the current environment state.
          </p>
          <button
            onClick={onAnalyzeScene}
            disabled={sceneLoading}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition mb-3"
          >
            {sceneLoading ? "Analyzing Scene..." : "Analyze Current Scene"}
          </button>
          {sceneError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-2">
              {sceneError}
            </div>
          )}
          {sceneResult && (
            <div className="space-y-2">
              {/* Hazards */}
              {sceneResult.hazards && sceneResult.hazards.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-red-400 mb-1">Detected Hazards</div>
                  {sceneResult.hazards.map((h: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-red-500/10 border border-red-500/20 mb-1">
                      <span className={`font-bold ${
                        (h.severity || "").toLowerCase() === "high" ? "text-red-400" :
                        (h.severity || "").toLowerCase() === "medium" ? "text-yellow-400" : "text-green-400"
                      }`}>{(h.severity || "?").toUpperCase()}</span>
                      <span className="text-slate-300">{h.type || h.description || JSON.stringify(h)}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Risk Score */}
              {sceneResult.risk_score != null && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Risk:</span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        sceneResult.risk_score > 0.7 ? "bg-red-500" :
                        sceneResult.risk_score > 0.3 ? "bg-yellow-500" : "bg-green-500"
                      }`}
                      style={{ width: `${(sceneResult.risk_score * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-400">{(sceneResult.risk_score * 100).toFixed(0)}%</span>
                </div>
              )}
              {/* Recommended Action */}
              {sceneResult.recommended_action && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2">
                  <div className="text-xs font-semibold text-indigo-400 mb-1">Recommended Action</div>
                  <div className="text-xs text-slate-300">{sceneResult.recommended_action}</div>
                </div>
              )}
              {/* AI Analysis */}
              {sceneResult.analysis && (
                <div className="bg-slate-900/60 rounded-lg p-2 max-h-32 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-400 mb-1">AI Reasoning</div>
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">{sceneResult.analysis}</div>
                </div>
              )}
              {/* Model used */}
              {sceneResult.model && (
                <div className="text-[10px] text-slate-600 font-mono">Model: {sceneResult.model}</div>
              )}
            </div>
          )}
        </Card>

        {/* Telemetry Analysis */}
        <Card title="📊 Telemetry Analysis" className="lg:col-span-1">
          <p className="text-xs text-slate-500 mb-3">
            AI analysis of recent telemetry trends, anomalies, and safety patterns.
          </p>
          <button
            onClick={onAnalyzeTelemetry}
            disabled={telAnalysisLoading || events.length === 0}
            className="w-full bg-teal-500 hover:bg-teal-600 disabled:bg-slate-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition mb-3"
          >
            {telAnalysisLoading ? "Analyzing..." : "Analyze Telemetry"}
          </button>
          {telAnalysisError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-2">
              {telAnalysisError}
            </div>
          )}
          {telAnalysis && (
            <div className="space-y-2">
              {telAnalysis.summary && (
                <div className="bg-slate-900/60 rounded-lg p-2 max-h-36 overflow-y-auto">
                  <div className="text-xs font-semibold text-teal-400 mb-1">Summary</div>
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">{telAnalysis.summary}</div>
                </div>
              )}
              {telAnalysis.anomalies && telAnalysis.anomalies.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-yellow-400 mb-1">Anomalies Detected</div>
                  {telAnalysis.anomalies.map((a: any, i: number) => (
                    <div key={i} className="text-xs p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-1 text-slate-300">
                      {a.description || a.type || JSON.stringify(a)}
                    </div>
                  ))}
                </div>
              )}
              {telAnalysis.recommendations && (
                <div className="bg-teal-500/10 border border-teal-500/20 rounded-lg p-2">
                  <div className="text-xs font-semibold text-teal-400 mb-1">Recommendations</div>
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">
                    {Array.isArray(telAnalysis.recommendations)
                      ? telAnalysis.recommendations.join("\n")
                      : telAnalysis.recommendations}
                  </div>
                </div>
              )}
              {telAnalysis.analysis && (
                <div className="bg-slate-900/60 rounded-lg p-2 max-h-32 overflow-y-auto">
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">{telAnalysis.analysis}</div>
                </div>
              )}
              {telAnalysis.model && (
                <div className="text-[10px] text-slate-600 font-mono">Model: {telAnalysis.model}</div>
              )}
            </div>
          )}
        </Card>

        {/* Failure Detection */}
        <Card title="⚠️ Failure Detection" className="lg:col-span-1">
          <p className="text-xs text-slate-500 mb-3">
            AI-powered pre-emptive failure detection and root-cause analysis.
          </p>
          <button
            onClick={onDetectFailures}
            disabled={failureLoading || events.length === 0}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-600 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition mb-3"
          >
            {failureLoading ? "Detecting..." : "Run Failure Analysis"}
          </button>
          {failureError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-2">
              {failureError}
            </div>
          )}
          {failureResult && (
            <div className="space-y-2">
              {/* Failure status */}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                  failureResult.failures_detected
                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : "bg-green-500/20 text-green-400 border-green-500/30"
                }`}>
                  {failureResult.failures_detected ? "Failures Detected" : "No Failures"}
                </span>
              </div>
              {/* Failures list */}
              {failureResult.failures && failureResult.failures.length > 0 && (
                <div>
                  {failureResult.failures.map((f: any, i: number) => (
                    <div key={i} className="text-xs p-2 rounded-lg bg-red-500/10 border border-red-500/20 mb-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-red-400">{f.type || "FAILURE"}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          f.severity === "critical" ? "bg-red-700 text-white" :
                          f.severity === "high" ? "bg-orange-600 text-white" : "bg-yellow-600 text-white"
                        }`}>{f.severity || "?"}</span>
                      </div>
                      <div className="text-slate-300">{f.description || JSON.stringify(f)}</div>
                      {f.root_cause && <div className="text-slate-500 mt-1">Root cause: {f.root_cause}</div>}
                    </div>
                  ))}
                </div>
              )}
              {/* Preventive actions */}
              {failureResult.preventive_actions && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-2">
                  <div className="text-xs font-semibold text-orange-400 mb-1">Preventive Actions</div>
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">
                    {Array.isArray(failureResult.preventive_actions)
                      ? failureResult.preventive_actions.join("\n")
                      : failureResult.preventive_actions}
                  </div>
                </div>
              )}
              {failureResult.analysis && (
                <div className="bg-slate-900/60 rounded-lg p-2 max-h-32 overflow-y-auto">
                  <div className="text-xs text-slate-300 whitespace-pre-wrap">{failureResult.analysis}</div>
                </div>
              )}
              {failureResult.model && (
                <div className="text-[10px] text-slate-600 font-mono">Model: {failureResult.model}</div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Agentic Reasoning Panel */}
      <Card title="🤖 Agentic Planner" className="col-span-full">
        <p className="text-xs text-slate-500 mb-3">
          Autonomous planning agent: assesses environment → validates policy → proposes safe action. Replans on denial.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={agenticInstruction}
            onChange={(e) => setAgenticInstruction(e.target.value)}
            placeholder="e.g. Move to loading bay while avoiding humans"
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            onKeyDown={(e) => e.key === "Enter" && onAgenticPropose()}
          />
          <button
            onClick={onAgenticPropose}
            disabled={agenticLoading || !agenticInstruction.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition whitespace-nowrap"
          >
            {agenticLoading ? "Thinking..." : "Run Agent"}
          </button>
        </div>
        {agenticError && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">
            {agenticError}
          </div>
        )}

        {/* Live agent status from WebSocket during active runs */}
        {liveThoughtChain.length > 0 && !agenticResult && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-purple-400 mb-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
              Agent Running
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">{liveThoughtChain.length} step{liveThoughtChain.length !== 1 ? "s" : ""}</span>
              {liveThoughtChain.map((step: any, i: number) => (
                <span key={i} className="bg-slate-700 text-cyan-300 px-1.5 py-0.5 rounded font-mono text-[10px]">
                  {step.action || "think"}
                </span>
              ))}
              {liveThoughtChain[liveThoughtChain.length - 1]?.action === "submit_action" && (
                <span className="text-green-400 text-xs font-semibold">✓ Submitted</span>
              )}
            </div>
          </div>
        )}

        {agenticResult && (
          <div className="space-y-3">
            {/* Replanning indicator */}
            {agenticResult.replanning_used && (
              <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <span className="text-amber-400">🔄</span>
                <span className="text-amber-300 font-semibold">Agent replanned after policy denial</span>
              </div>
            )}

            {/* Agent summary — tools used + step count (no raw chain-of-thought) */}
            {agenticResult.thought_chain && agenticResult.thought_chain.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-purple-400 mb-2">Agent Summary</div>
                <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-slate-400">{agenticResult.thought_chain.length} reasoning step{agenticResult.thought_chain.length !== 1 ? "s" : ""}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-slate-400">Tools used:</span>
                    {[...new Set(agenticResult.thought_chain.map((s: any) => s.action).filter(Boolean))].map((tool: string, i: number) => (
                      <span key={i} className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                        tool === "submit_action" ? "bg-green-500/20 text-green-300" :
                        tool === "check_policy" ? "bg-cyan-500/20 text-cyan-300" :
                        tool === "replan" || tool === "graceful_stop" ? "bg-amber-500/20 text-amber-300" :
                        "bg-slate-700 text-slate-300"
                      }`}>
                        {tool}
                      </span>
                    ))}
                  </div>
                  {/* Final decision line */}
                  {agenticResult.thought_chain[agenticResult.thought_chain.length - 1]?.action === "graceful_stop" && (
                    <div className="text-amber-400 text-xs mt-1">⚠ Agent could not find a safe plan — manual override recommended</div>
                  )}
                </div>
              </div>
            )}

            {/* Proposal result */}
            {agenticResult.proposal && (
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-3">
                <div className="text-xs font-semibold text-cyan-400 mb-2">Final Proposal</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Intent:</span>
                    <span className="text-slate-200 ml-1 font-semibold">{agenticResult.proposal.intent}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Speed:</span>
                    <span className="text-slate-200 ml-1">{agenticResult.proposal.params?.max_speed ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Target:</span>
                    <span className="text-slate-200 ml-1">
                      ({agenticResult.proposal.params?.x ?? "—"}, {agenticResult.proposal.params?.y ?? "—"})
                    </span>
                  </div>
                </div>
                {agenticResult.proposal.rationale && (
                  <div className="text-xs text-slate-400 mt-2 bg-slate-800/60 rounded p-2">
                    {agenticResult.proposal.rationale}
                  </div>
                )}
              </div>
            )}

            {/* Governance result */}
            {agenticResult.governance && (
              <div className={`border rounded-lg p-3 text-xs ${
                agenticResult.governance.decision === "APPROVED"
                  ? "bg-green-500/10 border-green-500/20"
                  : agenticResult.governance.decision === "DENIED"
                  ? "bg-red-500/10 border-red-500/20"
                  : "bg-yellow-500/10 border-yellow-500/20"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">
                    {agenticResult.governance.decision === "APPROVED" ? "✅" : agenticResult.governance.decision === "DENIED" ? "❌" : "⚠️"}
                    {" "}{agenticResult.governance.decision}
                  </span>
                  <span className="text-slate-400 ml-auto">
                    Risk: {(agenticResult.governance.risk_score * 100).toFixed(0)}%
                  </span>
                </div>
                {agenticResult.governance.reasons && agenticResult.governance.reasons.length > 0 && (
                  <ul className="text-slate-400 space-y-0.5 mt-1">
                    {agenticResult.governance.reasons.map((r: string, i: number) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Memory summary */}
            {agenticResult.memory_summary && (
              <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-2">
                <div className="text-[10px] font-semibold text-slate-500 mb-1">Agent Memory</div>
                <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
                  <span>Total: {agenticResult.memory_summary.total_entries}</span>
                  <span>Approved: {agenticResult.memory_summary.approved}</span>
                  <span>Denied: {agenticResult.memory_summary.denied}</span>
                  <span>Denials in a row: {agenticResult.memory_summary.denial_count}</span>
                </div>
              </div>
            )}

            {agenticResult.model_used && (
              <div className="text-[10px] text-slate-600 font-mono">Model: {agenticResult.model_used}</div>
            )}
          </div>
        )}
      </Card>

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