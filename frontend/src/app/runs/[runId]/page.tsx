"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getRun, listEvents, stopRun, getWorld, getPathPreview, triggerScenario, generateLLMPlan, executeLLMPlan, analyzeScene, analyzeTelemetry, detectFailures, agenticPropose, getMission } from "@/lib/api";
import { Map2D } from "@/components/Map2D";
import { wsUrlForRun } from "@/lib/ws";
import type { WsMessage } from "@/lib/types";

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 shadow-lg shadow-black/20 ${className}`}>
      <div className="font-bold text-sm text-slate-300 uppercase tracking-wide mb-3">{title}</div>
      {children}
    </div>
  );
}

function CollapsibleCard({ title, children, className = "", defaultOpen = false }: { title: string; children: React.ReactNode; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-slate-800/80 border border-slate-700/60 rounded-xl shadow-lg shadow-black/20 ${className}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-4 text-left">
        <span className="font-bold text-sm text-slate-300 uppercase tracking-wide">{title}</span>
        <span className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
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
  const [mission, setMission] = useState<any>(null);
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

  // ── Unified AI Mission Planner state ──
  const [missionInstruction, setMissionInstruction] = useState("");
  const [pipelineStage, setPipelineStage] = useState<"idle" | "reasoning" | "planning" | "governing" | "ready" | "executing" | "done">("idle");
  const [missionError, setMissionError] = useState<string | null>(null);
  // Agentic reasoning results
  const [agenticResult, setAgenticResult] = useState<any>(null);
  // LLM plan results
  const [llmPlan, setLlmPlan] = useState<any>(null);
  const [llmExecResult, setLlmExecResult] = useState<any>(null);
  // Live agentic reasoning from WebSocket
  const [liveThoughtChain, setLiveThoughtChain] = useState<any[]>([]);

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

  // AI Intelligence Console tab
  const [aiTab, setAiTab] = useState<"scene" | "telemetry" | "failure">("scene");

  // Replan tracking
  const [replanCount, setReplanCount] = useState(0);
  const [lastDenialPolicy, setLastDenialPolicy] = useState<string | null>(null);

  // Autonomous mode
  const [autonomousMode, setAutonomousMode] = useState(true);

  // Active waypoint tracking during execution
  const [activeWaypointIdx, setActiveWaypointIdx] = useState<number>(-1);

  async function refreshEvents() {
    try {
      const rows = await listEvents(runId);
      setEvents(rows);
    } catch (_) {}
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await getRun(runId);
        setRun(r);
        // Fetch the parent mission to pre-fill instruction & goal
        if (r?.mission_id) {
          try {
            const m = await getMission(r.mission_id);
            setMission(m);
            if (m?.title && !missionInstruction) {
              setMissionInstruction(m.title);
            }
          } catch (_) {}
        }
      } catch (_) {}
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

  // ── Unified Pipeline: Reason → Plan → Govern → Execute ──
  async function onRunPipeline() {
    if (!missionInstruction.trim()) return;
    setMissionError(null);
    setAgenticResult(null);
    setLlmPlan(null);
    setLlmExecResult(null);
    setActiveWaypointIdx(-1);

    // Stage 1: Agentic Reasoning
    setPipelineStage("reasoning");
    const missionGoal = mission?.goal || undefined;
    try {
      const aResult = await agenticPropose(missionInstruction, missionGoal);
      setAgenticResult(aResult);
      // Track replanning
      if (aResult.replanning_used) {
        setReplanCount((c) => c + 1);
        const deniedStep = (aResult.thought_chain || []).find((s: any) => s.action === "replan");
        if (deniedStep) {
          const policyMatch = deniedStep.thought?.match(/Policies?:\s*([A-Z_0-9]+)/i);
          setLastDenialPolicy(policyMatch ? policyMatch[1] : "POLICY_HIT");
        }
      }
    } catch (e: any) {
      setMissionError(e.message || "Reasoning failed");
      setPipelineStage("idle");
      return;
    }

    // Stage 2: Generate multi-waypoint plan
    setPipelineStage("planning");
    try {
      const plan = await generateLLMPlan(missionInstruction, missionGoal);
      setLlmPlan(plan);
      // If plan has governance failures, auto-replan once
      if (plan && !plan.all_approved && autonomousMode) {
        setReplanCount((c) => c + 1);
        const failedGov = plan.governance?.find((g: any) => g.decision !== "APPROVED");
        if (failedGov) {
          setLastDenialPolicy(failedGov.policy_hits?.[0] || "POLICY_HIT");
        }
        // Replan with adjusted instruction
        setPipelineStage("planning");
        try {
          const replan = await generateLLMPlan(`${missionInstruction} (avoid policy violations, use slower speed)`, missionGoal);
          if (replan) setLlmPlan(replan);
        } catch (_) {}
      }
      setPipelineStage(plan ? "ready" : "idle");
    } catch (e: any) {
      setMissionError(e.message || "Plan generation failed");
      setPipelineStage("idle");
    }
  }

  async function onExecutePipeline() {
    if (!llmPlan?.waypoints?.length) return;
    setPipelineStage("executing");
    setMissionError(null);
    setLlmExecResult(null);
    setActiveWaypointIdx(0);
    try {
      const result = await executeLLMPlan(
        missionInstruction,
        llmPlan.waypoints,
        llmPlan.rationale || ""
      );
      // Animate through waypoints
      for (let i = 0; i < (result.steps?.length || 0); i++) {
        setActiveWaypointIdx(i);
        await new Promise(r => setTimeout(r, 600));
      }
      setLlmExecResult(result);
      setActiveWaypointIdx(-1);
      setPipelineStage("done");
    } catch (e: any) {
      setMissionError(e.message || "Execution failed");
      setActiveWaypointIdx(-1);
      setPipelineStage("ready");
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

  const safetyBannerCls: Record<string, string> = {
    OK: "bg-green-500/15 border-green-500/30 text-green-400",
    STOP: "bg-red-500/20 border-red-500/40 text-red-400",
    SLOW: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400",
    REPLAN: "bg-blue-500/15 border-blue-500/30 text-blue-400",
  };
  const safetyIcon: Record<string, string> = { OK: "✅", STOP: "🔴", SLOW: "🟡", REPLAN: "🔵" };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-4 space-y-3">
      {/* ── Compact Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white">
            <span className="text-cyan-400 font-mono">{runId.slice(0, 12)}</span>
          </h1>
          <StatusBadge status={currentStatus} />
          <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
            wsConnected ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-green-400" : "bg-red-400 animate-pulse"}`} />
            {wsConnected ? "Live" : "Offline"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run?.mission_id && <span className="text-xs text-slate-500 font-mono">{run.mission_id}</span>}
          {currentStatus !== "stopped" && (
            <button onClick={onStop} className="bg-red-500/80 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              Stop
            </button>
          )}
        </div>
      </div>

      {/* ── Safety Banner (full-width, thin, color-coded) ── */}
      <div className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold animate-banner-pulse ${safetyBannerCls[safety.state] || safetyBannerCls.OK}`}>
        <span>{safetyIcon[safety.state] || "✅"}</span>
        <span>{safety.state}</span>
        {safety.state !== "OK" && <span className="font-normal opacity-80">— {safety.detail}</span>}
      </div>

      {/* ── MAIN LAYOUT: Hero Map (left 60%) + Sidebar (right 40%) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">

        {/* ── LEFT: Hero Map ── */}
        <div className="lg:col-span-3 space-y-3">
          <Card title="Warehouse Simulation">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-slate-400 flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} className="accent-cyan-500 w-3 h-3" />
                  Heatmap
                </label>
                <label className="text-[10px] text-slate-400 flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} className="accent-cyan-500 w-3 h-3" />
                  Trail
                </label>
              </div>
              {/* Scenario triggers inline */}
              <div className="flex items-center gap-1">
                {scenarioToast && <span className="text-[10px] text-cyan-300 animate-pulse mr-2">{scenarioToast}</span>}
                {([
                  { key: "human_approach", label: "🚶", cls: "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/20" },
                  { key: "human_too_close", label: "🛑", cls: "border-red-500/40 text-red-400 hover:bg-red-500/20" },
                  { key: "path_blocked", label: "🚧", cls: "border-blue-500/40 text-blue-400 hover:bg-blue-500/20" },
                  { key: "clear", label: "✅", cls: "border-green-500/40 text-green-400 hover:bg-green-500/20" },
                ] as const).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => onScenario(s.key)}
                    disabled={!!scenarioLoading || currentStatus === "stopped"}
                    title={s.key.replace(/_/g, " ")}
                    className={`border rounded-md px-1.5 py-1 text-xs transition disabled:opacity-30 relative ${s.cls} ${scenarioLoading === s.key ? "animate-pulse" : ""} ${scenarioLoading === s.key ? `scenario-active-ring ${s.key === "human_approach" ? "ring-yellow" : s.key === "human_too_close" ? "ring-red" : s.key === "path_blocked" ? "ring-blue" : "ring-green"}` : ""}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-[450px]">
              <Map2D world={world} telemetry={telemetry} pathPoints={pathPoints} planWaypoints={llmPlan?.waypoints || null} showHeatmap={showHeatmap} showTrail={showTrail} safetyState={safety.state} />
            </div>
            <p className="text-[10px] text-slate-600 mt-1">Scroll to zoom · Drag to pan · Cyan: robot · Red: obstacles · Orange: human · Purple: plan</p>
          </Card>

          {/* ── Unified AI Mission Planner ── */}
          <Card title="🤖 AI Mission Planner">
            {/* Autonomous Mode + Memory + Replan badges */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button onClick={() => setAutonomousMode(!autonomousMode)}
                className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border transition ${
                  autonomousMode
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20"
                    : "bg-slate-700/50 text-slate-400 border-slate-600"
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${autonomousMode ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                Autonomous: {autonomousMode ? "ON" : "OFF"}
              </button>
              {agenticResult?.memory_summary && (
                <span className="text-[10px] text-slate-400 bg-slate-700/50 px-2 py-1 rounded-full border border-slate-600">
                  🧠 Memory: {agenticResult.memory_summary.total_entries || 0} decisions retained
                </span>
              )}
              {replanCount > 0 && (
                <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/15 px-2 py-1 rounded-full border border-amber-500/30">
                  🔄 Replans: {replanCount}{lastDenialPolicy ? ` — ${lastDenialPolicy}` : ""}
                </span>
              )}
            </div>

            {/* Pipeline progress bar */}
            <div className="flex items-center gap-0 mb-3 text-[10px] font-semibold">
              {([
                { key: "reasoning", label: "Reasoning", icon: "🧠" },
                { key: "planning", label: "Plan", icon: "🗺️" },
                { key: "ready", label: "Governance", icon: "🛡️" },
                { key: "executing", label: "Execute", icon: "🚀" },
              ] as const).map((stage, i) => {
                const stageOrder = ["idle", "reasoning", "planning", "ready", "executing", "done"];
                const currentIdx = stageOrder.indexOf(pipelineStage);
                const stageIdx = stageOrder.indexOf(stage.key);
                const isActive = pipelineStage === stage.key;
                const isDone = currentIdx > stageIdx;
                return (
                  <React.Fragment key={stage.key}>
                    {i > 0 && <div className={`flex-1 h-0.5 mx-1 rounded ${isDone ? "bg-green-500" : isActive ? "bg-purple-500 animate-pulse" : "bg-slate-700"}`} />}
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                      isActive ? "border-purple-500/50 bg-purple-500/15 text-purple-300" :
                      isDone ? "border-green-500/30 bg-green-500/10 text-green-400" :
                      "border-slate-700 text-slate-600"
                    }`}>
                      <span>{isDone ? "✓" : stage.icon}</span>
                      <span>{stage.label}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Mission context badge */}
            {mission && (
              <div className="flex items-center gap-2 mb-2 text-xs text-slate-400">
                <span className="bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 px-2 py-0.5 rounded-full">
                  Mission: {mission.title}
                </span>
                {mission.goal && (
                  <span className="bg-slate-700/50 border border-slate-600 text-slate-300 px-2 py-0.5 rounded-full">
                    Goal: ({mission.goal.x}, {mission.goal.y})
                  </span>
                )}
              </div>
            )}

            {/* Instruction input */}
            <div className="flex gap-2 mb-3">
              <input type="text" value={missionInstruction} onChange={(e) => setMissionInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && pipelineStage === "idle" && onRunPipeline()}
                placeholder={mission?.title || "Navigate to loading bay avoiding obstacles"}
                className="flex-1 bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500 placeholder:text-slate-500" />
              <button onClick={onRunPipeline}
                disabled={pipelineStage !== "idle" || !missionInstruction.trim()}
                className="bg-purple-500 hover:bg-purple-600 disabled:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition whitespace-nowrap">
                {pipelineStage === "reasoning" ? "🧠 Reasoning..." : pipelineStage === "planning" ? "🗺️ Planning..." : "Plan →"}
              </button>
            </div>

            {missionError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-2">{missionError}</div>}

            {/* Live reasoning spinner */}
            {pipelineStage === "reasoning" && liveThoughtChain.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-2 animate-slide-up">
                <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                <span className="text-xs text-slate-400">{liveThoughtChain.length} reasoning steps</span>
                {liveThoughtChain.map((step: any, i: number) => (
                  <span key={i} className="bg-slate-700 text-cyan-300 px-1.5 py-0.5 rounded font-mono text-[10px]">{step.action || "think"}</span>
                ))}
              </div>
            )}

            {/* Stage 1 result: Agent Reasoning — STRUCTURED FORMAT */}
            {agenticResult && (
              <div className="space-y-2 mb-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Reasoning</div>
                {agenticResult.replanning_used && (
                  <div className="flex items-center gap-2 text-[10px] bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1 animate-slide-up">
                    <span>🔄</span><span className="text-amber-300 font-semibold">Replanned after policy denial</span>
                    {lastDenialPolicy && <span className="text-amber-400/70 font-mono">({lastDenialPolicy})</span>}
                  </div>
                )}

                {/* Structured reasoning display — Goal / Constraints / Strategy / Confidence */}
                <div className="bg-slate-900/60 border border-purple-500/20 rounded-lg p-3 space-y-1.5 text-xs font-mono">
                  <div className="flex items-start gap-2">
                    <span className="text-purple-400 font-bold min-w-[80px]">Goal:</span>
                    <span className="text-white">{missionInstruction || "—"}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-cyan-400 font-bold min-w-[80px]">Constraints:</span>
                    <div className="text-slate-300 space-y-0.5">
                      {world?.human && <div>- Human at ({world.human.x}, {world.human.y})</div>}
                      {(world?.obstacles || []).slice(0, 2).map((o: any, i: number) => (
                        <div key={i}>- Obstacle at ({o.x}, {o.y})</div>
                      ))}
                      {telemetry && <div>- Zone speed limit: {telemetry.zone === "loading_bay" ? "0.4" : "0.5"} m/s</div>}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-400 font-bold min-w-[80px]">Strategy:</span>
                    <div className="text-slate-300 space-y-0.5">
                      {(agenticResult.thought_chain || []).filter((s: any) => s.thought && s.action !== "replan").slice(0, 3).map((s: any, i: number) => (
                        <div key={i}>- {s.thought}</div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 font-bold min-w-[80px]">Confidence:</span>
                    <span className={`font-bold ${
                      agenticResult.governance?.risk_score < 0.3 ? "text-green-400" : agenticResult.governance?.risk_score < 0.7 ? "text-yellow-400" : "text-red-400"
                    }`}>{(100 - (agenticResult.governance?.risk_score || 0) * 100).toFixed(0)}%</span>
                    <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden ml-1">
                      <div className={`h-full rounded-full transition-all duration-500 ${
                        agenticResult.governance?.risk_score < 0.3 ? "bg-green-500" : agenticResult.governance?.risk_score < 0.7 ? "bg-yellow-500" : "bg-red-500"
                      }`} style={{ width: `${100 - (agenticResult.governance?.risk_score || 0) * 100}%` }} />
                    </div>
                  </div>
                </div>

                {/* Tool use chips */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500 text-[10px]">{agenticResult.thought_chain?.length || 0} steps</span>
                  {[...new Set((agenticResult.thought_chain || []).map((s: any) => s.action).filter(Boolean))].map((tool: string, i: number) => (
                    <span key={i} className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                      tool === "submit_action" ? "bg-green-500/20 text-green-300" : tool === "check_policy" ? "bg-cyan-500/20 text-cyan-300" : tool === "graceful_stop" ? "bg-amber-500/20 text-amber-300" : tool === "replan" ? "bg-red-500/20 text-red-300" : "bg-slate-700 text-slate-300"
                    }`}>{tool}</span>
                  ))}
                  {agenticResult.proposal && (
                    <>
                      <span className="text-slate-600">→</span>
                      <span className="font-semibold text-cyan-400">{agenticResult.proposal.intent}</span>
                      {agenticResult.proposal.params?.x != null && <span className="text-slate-400">({agenticResult.proposal.params.x}, {agenticResult.proposal.params.y})</span>}
                    </>
                  )}
                </div>

                {/* Governance inline */}
                {agenticResult.governance && (
                  <div className={`flex items-center justify-between text-xs rounded px-2 py-1.5 border ${
                    agenticResult.governance.decision === "APPROVED" ? "bg-green-500/10 border-green-500/20" : agenticResult.governance.decision === "DENIED" ? "bg-red-500/10 border-red-500/20" : "bg-yellow-500/10 border-yellow-500/20"
                  }`}>
                    <span className="font-semibold">
                      {agenticResult.governance.decision === "APPROVED" ? "✅" : agenticResult.governance.decision === "DENIED" ? "❌" : "⚠️"} {agenticResult.governance.decision}
                    </span>
                    <span className="text-slate-400">Risk: {(agenticResult.governance.risk_score * 100).toFixed(0)}%</span>
                  </div>
                )}
                {agenticResult.model_used && <div className="text-[10px] text-slate-600 font-mono">Model: {agenticResult.model_used}</div>}
              </div>
            )}

            {/* Stage 2 result: Waypoint Plan */}
            {llmPlan && (
              <div className="space-y-2 mb-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Waypoint Plan</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${llmPlan.all_approved ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}`}>
                    {llmPlan.all_approved ? "All Approved" : "Flagged"}
                  </span>
                  <span className="text-[10px] text-slate-500">{llmPlan.waypoints?.length || 0} waypoints</span>
                  <span className="text-[10px] text-purple-400">{llmPlan.rationale}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(llmPlan.waypoints || []).map((wp: any, i: number) => {
                    const gov = llmPlan.governance?.[i]; const ok = gov?.decision === "APPROVED";
                    const isActive = activeWaypointIdx === i;
                    const isCompleted = activeWaypointIdx > i;
                    const isNext = activeWaypointIdx >= 0 && activeWaypointIdx + 1 === i;
                    return (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded border transition-all duration-300 ${
                        isActive ? "border-cyan-400 bg-cyan-500/25 text-cyan-200 shadow-sm shadow-cyan-500/30 scale-105 font-bold" :
                        isCompleted ? "border-green-500/40 bg-green-500/15 text-green-400 line-through opacity-70" :
                        isNext ? "border-purple-400/40 bg-purple-500/10 text-purple-300 animate-pulse" :
                        ok ? "border-green-500/30 text-green-400" : "border-yellow-500/30 text-yellow-400"
                      }`}>
                        {isCompleted ? "✓" : isActive ? "▶" : `${i + 1}:`} ({wp.x.toFixed(0)},{wp.y.toFixed(0)}) @{wp.max_speed}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Execute button */}
            {pipelineStage === "ready" && llmPlan && (
              <button onClick={onExecutePipeline} disabled={currentStatus === "stopped"}
                className="w-full bg-green-500/80 hover:bg-green-600 disabled:bg-slate-600 text-white text-xs font-semibold py-2 rounded-lg transition mb-2">
                🚀 Execute Plan in Simulation
              </button>
            )}
            {pipelineStage === "executing" && (
              <div className="text-xs text-purple-300 animate-pulse text-center py-2">Executing waypoints…</div>
            )}

            {/* Stage 3 result: Execution */}
            {llmExecResult && (
              <div className="space-y-1 mb-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Execution Result</div>
                <span className={`text-xs font-semibold ${llmExecResult.status === "completed" ? "text-green-400" : "text-yellow-400"}`}>
                  {llmExecResult.status?.toUpperCase()}
                </span>
                {(llmExecResult.steps || []).map((step: any, i: number) => (
                  <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${step.executed ? "bg-green-500/10" : "bg-red-500/10"}`}>
                    <span className="font-mono text-purple-400">WP{step.waypoint_index + 1}</span>
                    <span className={step.executed ? "text-green-400" : "text-red-400"}>{step.executed ? "✓" : "✗"}</span>
                    <span className="text-slate-500">{step.policy_state}</span>
                  </div>
                ))}
                <div className="text-[10px] text-slate-600 font-mono">Hash: {llmExecResult.audit_hash?.slice(0, 20)}…</div>
              </div>
            )}

            {/* Reset button when done */}
            {(pipelineStage === "done" || pipelineStage === "ready") && (
              <button onClick={() => { setPipelineStage("idle"); setAgenticResult(null); setLlmPlan(null); setLlmExecResult(null); setMissionError(null); setReplanCount(0); setLastDenialPolicy(null); setActiveWaypointIdx(-1); }}
                className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition">
                ↺ New Mission
              </button>
            )}
          </Card>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="lg:col-span-2 space-y-3">

          {/* Compact Governance Decision */}
          <Card title="Governance Decision">
            {!lastDecision ? (
              <div className="text-slate-500 text-xs text-center py-3">⏳ Awaiting first decision…</div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className={`font-bold text-sm ${
                    lastDecision.governance?.decision === "APPROVED" ? "text-green-400" : lastDecision.governance?.decision === "DENIED" ? "text-red-400" : "text-yellow-400"
                  }`}>{lastDecision.governance?.decision || "—"}</span>
                  <span className="text-slate-400">Risk: {lastDecision.governance?.risk_score != null ? (lastDecision.governance.risk_score * 100).toFixed(0) + "%" : "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Intent:</span>
                  <span className="text-white font-semibold">{lastDecision.proposal?.intent || "—"}</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-500">Policy:</span>
                  <span className="text-slate-300 font-mono text-[10px]">{(lastDecision.governance?.policy_hits || []).join(", ") || "none"}</span>
                </div>
                {lastDecision.governance?.reasons?.length > 0 && (
                  <div className="text-slate-400 bg-slate-900/40 rounded p-2">
                    {lastDecision.governance.reasons.map((r: string, i: number) => <div key={i}>• {r}</div>)}
                  </div>
                )}
                {lastDecision.governance?.required_action && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded px-2 py-1 text-yellow-300">
                    {lastDecision.governance.required_action}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Compact Telemetry */}
          <CollapsibleCard title="Live Telemetry" defaultOpen={false}>
            {!telemetry ? (
              <div className="text-slate-500 text-xs text-center py-2">📡 Waiting…</div>
            ) : (
              <div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                  <div><span className="text-slate-500">x:</span> <span className="text-white font-mono">{(+telemetry.x).toFixed(1)}</span></div>
                  <div><span className="text-slate-500">y:</span> <span className="text-white font-mono">{(+telemetry.y).toFixed(1)}</span></div>
                  <div><span className="text-slate-500">heading:</span> <span className="text-white font-mono">{((+telemetry.theta || 0) * 180 / Math.PI).toFixed(0)}°</span></div>
                  <div><span className="text-slate-500">speed:</span> <span className="text-white font-mono">{(+telemetry.speed).toFixed(2)} m/s</span></div>
                  <div><span className="text-slate-500">human:</span> <span className="text-white font-mono">{(+telemetry.human_distance_m).toFixed(1)}m</span></div>
                  <div><span className="text-slate-500">obstacle:</span> <span className="text-white font-mono">{(+telemetry.nearest_obstacle_m).toFixed(1)}m</span></div>
                </div>
                <details>
                  <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400">Show Raw JSON</summary>
                  <pre className="text-[10px] text-green-400/70 bg-slate-900/60 p-2 rounded mt-1 overflow-x-auto max-h-40 overflow-y-auto font-mono">
{JSON.stringify(telemetry, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </CollapsibleCard>

          {/* Chain-of-Trust Timeline (compact, icons) */}
          <Card title="Chain-of-Trust">
            {events.length === 0 ? (
              <div className="text-slate-500 text-xs text-center py-2">🔗 No events yet.</div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-0.5 timeline-live-line">
                {events.slice(-10).reverse().map((e) => {
                  const icon = e.type === "DECISION" ? "🔵" : e.type === "TELEMETRY" ? "🟢" : "🟠";
                  return (
                    <details key={e.id} className="group">
                      <summary className="cursor-pointer py-1.5 flex items-center gap-1.5 text-xs hover:bg-slate-700/30 rounded px-1 -mx-1">
                        <span className="text-[10px]">{icon}</span>
                        <span className="text-slate-500 font-mono text-[10px]">{new Date(e.ts).toLocaleTimeString()}</span>
                        <span className="font-semibold text-[10px] text-slate-300">{e.type}</span>
                        <span className="text-slate-700 text-[10px] font-mono ml-auto">{e.hash?.slice(0, 8)}…</span>
                      </summary>
                      <pre className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded overflow-x-auto mt-0.5 font-mono max-h-24 overflow-y-auto">
{JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </details>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Alerts */}
          <Card title="Alerts">
            {alerts.length === 0 ? (
              <div className="text-xs text-slate-500 space-y-1">
                <div className="flex items-center gap-2 bg-green-500/5 border border-green-500/10 rounded px-2 py-1">
                  <span className="text-green-400 text-[10px]">●</span>
                  <span className="text-slate-400">Battery at 96% (Normal)</span>
                </div>
                <div className="flex items-center gap-2 bg-green-500/5 border border-green-500/10 rounded px-2 py-1">
                  <span className="text-green-400 text-[10px]">●</span>
                  <span className="text-slate-400">Path deviation 0.12m (Within tolerance)</span>
                </div>
                <div className="flex items-center gap-2 bg-green-500/5 border border-green-500/10 rounded px-2 py-1">
                  <span className="text-green-400 text-[10px]">●</span>
                  <span className="text-slate-400">Motor temp 42°C (Normal)</span>
                </div>
              </div>
            ) : (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {alerts.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                    <span className="text-red-400">⚠️</span>
                    <span className="text-slate-300">{a.event || JSON.stringify(a)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── AI Intelligence Console (tabbed, below main layout) ── */}
      <CollapsibleCard title="AI Intelligence Console" defaultOpen={false}>
        <div className="flex gap-1 mb-3">
          {(["scene", "telemetry", "failure"] as const).map((tab) => (
            <button key={tab} onClick={() => setAiTab(tab)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition ${aiTab === tab ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/50"}`}>
              {tab === "scene" ? "🔍 Scene" : tab === "telemetry" ? "📊 Telemetry" : "⚠️ Failures"}
            </button>
          ))}
        </div>

        {aiTab === "scene" && (
          <div>
            <button onClick={onAnalyzeScene} disabled={sceneLoading}
              className="w-full bg-indigo-500/80 hover:bg-indigo-600 disabled:bg-slate-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition mb-2">
              {sceneLoading ? "Analyzing..." : "Analyze Current Scene"}
            </button>
            {sceneError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 mb-2">{sceneError}</div>}
            {sceneResult && (
              <div className="space-y-2 text-xs">
                {sceneResult.hazards?.length > 0 && sceneResult.hazards.map((h: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded p-2">
                    <span className={`font-bold ${h.severity === "high" ? "text-red-400" : "text-yellow-400"}`}>{(h.severity || "?").toUpperCase()}</span>
                    <span className="text-slate-300">{h.type || h.description}</span>
                  </div>
                ))}
                {sceneResult.risk_score != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Risk:</span>
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${sceneResult.risk_score > 0.7 ? "bg-red-500" : sceneResult.risk_score > 0.3 ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${(sceneResult.risk_score * 100)}%` }} />
                    </div>
                    <span className="font-mono text-slate-400">{(sceneResult.risk_score * 100).toFixed(0)}%</span>
                  </div>
                )}
                {sceneResult.recommended_action && <div className="bg-indigo-500/10 border border-indigo-500/20 rounded p-2 text-slate-300">{sceneResult.recommended_action}</div>}
                {sceneResult.analysis && <div className="bg-slate-900/60 rounded p-2 max-h-28 overflow-y-auto text-slate-300 whitespace-pre-wrap">{sceneResult.analysis}</div>}
                {sceneResult.model && <div className="text-[10px] text-slate-600 font-mono">Model: {sceneResult.model}</div>}
              </div>
            )}
          </div>
        )}

        {aiTab === "telemetry" && (
          <div>
            <button onClick={onAnalyzeTelemetry} disabled={telAnalysisLoading || events.length === 0}
              className="w-full bg-teal-500/80 hover:bg-teal-600 disabled:bg-slate-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition mb-2">
              {telAnalysisLoading ? "Analyzing..." : "Analyze Telemetry"}
            </button>
            {telAnalysisError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 mb-2">{telAnalysisError}</div>}
            {telAnalysis && (
              <div className="space-y-2 text-xs">
                {telAnalysis.summary && <div className="bg-slate-900/60 rounded p-2 max-h-28 overflow-y-auto text-slate-300 whitespace-pre-wrap">{telAnalysis.summary}</div>}
                {telAnalysis.anomalies?.length > 0 && telAnalysis.anomalies.map((a: any, i: number) => (
                  <div key={i} className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-slate-300">{a.description || a.type}</div>
                ))}
                {telAnalysis.recommendations && (
                  <div className="bg-teal-500/10 border border-teal-500/20 rounded p-2 text-slate-300 whitespace-pre-wrap">
                    {Array.isArray(telAnalysis.recommendations) ? telAnalysis.recommendations.join("\n") : telAnalysis.recommendations}
                  </div>
                )}
                {telAnalysis.model && <div className="text-[10px] text-slate-600 font-mono">Model: {telAnalysis.model}</div>}
              </div>
            )}
          </div>
        )}

        {aiTab === "failure" && (
          <div>
            <button onClick={onDetectFailures} disabled={failureLoading || events.length === 0}
              className="w-full bg-orange-500/80 hover:bg-orange-600 disabled:bg-slate-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition mb-2">
              {failureLoading ? "Detecting..." : "Run Failure Analysis"}
            </button>
            {failureError && <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 mb-2">{failureError}</div>}
            {failureResult && (
              <div className="space-y-2 text-xs">
                <span className={`font-semibold px-2 py-0.5 rounded-full border text-[10px] ${failureResult.failures_detected ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}`}>
                  {failureResult.failures_detected ? "Failures Detected" : "No Failures"}
                </span>
                {failureResult.failures?.map((f: any, i: number) => (
                  <div key={i} className="bg-red-500/10 border border-red-500/20 rounded p-2">
                    <span className="font-bold text-red-400">{f.type}</span> <span className="text-[10px] bg-red-700 text-white px-1 rounded">{f.severity}</span>
                    <div className="text-slate-300 mt-1">{f.description}</div>
                  </div>
                ))}
                {failureResult.preventive_actions && (
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded p-2 text-slate-300 whitespace-pre-wrap">
                    {Array.isArray(failureResult.preventive_actions) ? failureResult.preventive_actions.join("\n") : failureResult.preventive_actions}
                  </div>
                )}
                {failureResult.model && <div className="text-[10px] text-slate-600 font-mono">Model: {failureResult.model}</div>}
              </div>
            )}
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}