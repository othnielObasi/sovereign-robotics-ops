'use client';

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listMissions, createMission, startRun, listRuns, getScoreTrends, getCrossRunLearning, getTuningRecommendations, checkCrossRunIntegrity, getOptimizationEnvelope } from "@/lib/api";
import type { Mission, MissionStatus } from "@/lib/types";

// API configuration
const API_URL = process.env.NEXT_PUBLIC_API_BASE || "/api";

interface SystemStatus {
  api: 'connected' | 'disconnected' | 'checking';
  gemini: 'enabled' | 'disabled' | 'unknown';
  database: 'connected' | 'disconnected' | 'unknown';
}

// Realistic warehouse mission presets
const PRESETS = [
  { title: "Deliver pallet to Bay 3",              goalX: 15, goalY: 7,  icon: "📦" },
  { title: "Pick up returns from Dock A",           goalX: 25, goalY: 15, icon: "🔄" },
  { title: "Transport hazmat container to Zone D",  goalX: 8,  goalY: 18, icon: "⚠️" },
  { title: "Restock shelf B-12 from cold storage",  goalX: 20, goalY: 4,  icon: "🧊" },
  { title: "Patrol perimeter for safety audit",     goalX: 28, goalY: 10, icon: "🛡️" },
  { title: "Move fragile goods to shipping lane",   goalX: 12, goalY: 14, icon: "🏷️" },
];

const STATUS_BADGE: Record<MissionStatus, { label: string; cls: string }> = {
  draft:     { label: "Draft",      cls: "bg-slate-600 text-slate-200" },
  executing: { label: "Executing",  cls: "bg-green-600 text-white animate-pulse" },
  paused:    { label: "Paused",     cls: "bg-yellow-600 text-white" },
  completed: { label: "Completed",  cls: "bg-cyan-700 text-white" },
  deleted:   { label: "Deleted",    cls: "bg-red-800 text-red-200" },
};

export default function HomePage() {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [status, setStatus] = useState<SystemStatus>({
    api: 'checking',
    gemini: 'unknown',
    database: 'unknown'
  });
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Deliver to Bay 3");
  const [goalX, setGoalX] = useState(15);
  const [goalY, setGoalY] = useState(7);
  const [creating, setCreating] = useState(false);
  const [missionRunIds, setMissionRunIds] = useState<Record<string, string>>({});

  // Phase E: Analytics data
  const [scoreTrends, setScoreTrends] = useState<any[]>([]);
  const [crossRunLearning, setCrossRunLearning] = useState<any>(null);
  const [tuningRecs, setTuningRecs] = useState<any>(null);
  const [crossRunIntegrity, setCrossRunIntegrity] = useState<any>(null);
  const [optimizationEnvelope, setOptimizationEnvelope] = useState<any>(null);

  // Check API health
  useEffect(() => {
    async function checkHealth() {
      try {
        let res: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            res = await fetch(`${API_URL}/health`, { cache: "no-store" });
            break;
          } catch {
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
        if (res && res.ok) {
          const data = await res.json();
          setStatus({
            api: 'connected',
            gemini: data.gemini_enabled ? 'enabled' : 'disabled',
            database: 'connected'
          });
          setError(null);
        } else {
          throw new Error('API returned error');
        }
      } catch (e) {
        setStatus(prev => ({ ...prev, api: 'disconnected' }));
        setError('Cannot connect to backend API. Please check your deployment.');
      }
    }
    
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch missions
  useEffect(() => {
    async function fetchMissions() {
      if (status.api !== 'connected') return;
      
      try {
        const data = await listMissions();
        setMissions(data);
        // Fetch latest run_id for executing/completed missions
        const runMap: Record<string, string> = {};
        await Promise.all(
          data
            .filter((m: any) => m.status === 'executing' || m.status === 'completed' || m.status === 'paused')
            .map(async (m: any) => {
              try {
                const runs = await listRuns(m.id);
                if (runs.length > 0) runMap[m.id] = runs[0].id;
              } catch {}
            })
        );
        setMissionRunIds(runMap);
      } catch (e) {
        console.error('Failed to fetch missions:', e);
      }
    }
    
    fetchMissions();
  }, [status.api]);

  // Phase E: Fetch analytics when connected
  useEffect(() => {
    if (status.api !== 'connected') return;
    (async () => {
      try { setScoreTrends((await getScoreTrends(20)).trends || []); } catch (_) {}
      try { setCrossRunLearning(await getCrossRunLearning()); } catch (_) {}
      try { setTuningRecs(await getTuningRecommendations()); } catch (_) {}
      try { setCrossRunIntegrity(await checkCrossRunIntegrity()); } catch (_) {}
      try { setOptimizationEnvelope(await getOptimizationEnvelope()); } catch (_) {}
    })();
  }, [status.api]);

  // Create mission
  async function handleCreate() {
    setCreating(true);
    setError(null);
    
    try {
      const data = await createMission({ title, goal: { x: goalX, y: goalY } });
      setMissions(prev => [data, ...prev]);
      setTitle("Deliver to Bay 3");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleStartRun(missionId: string) {
    try {
      const data = await startRun(missionId);
      router.push(`/runs/${data.run_id}`);
    } catch (e: any) {
      setError(e.message || 'Failed to start run');
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Sovereign Robotics Ops
          </span>
        </h1>
        <p className="text-xl text-slate-400 mb-6">
          The governance layer for autonomous robot control
        </p>
        <Link 
          href="/demo" 
          className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition shadow-lg shadow-cyan-500/30"
        >
          🎮 Try Interactive Demo
        </Link>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* API Status */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Backend API</span>
            <div className={`w-3 h-3 rounded-full ${
              status.api === 'connected' ? 'bg-green-500' :
              status.api === 'checking' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
            }`} />
          </div>
          <div className="text-2xl font-bold">
            {status.api === 'connected' ? '✅ Connected' :
             status.api === 'checking' ? '⏳ Checking...' : '❌ Disconnected'}
          </div>
          <p className="text-xs text-slate-500 mt-1">{API_URL || '(same origin)'}</p>
        </div>

        {/* Gemini Status */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Gemini Robotics</span>
            <div className={`w-3 h-3 rounded-full ${
              status.gemini === 'enabled' ? 'bg-green-500' :
              status.gemini === 'disabled' ? 'bg-yellow-500' : 'bg-slate-500'
            }`} />
          </div>
          <div className="text-2xl font-bold">
            {status.gemini === 'enabled' ? '🤖 Enabled' :
             status.gemini === 'disabled' ? '📦 Mock Mode' : '❓ Unknown'}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {status.gemini === 'disabled' ? 'Using mock fallback' : 'AI planning active'}
          </p>
        </div>

        {/* Governance Status */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Governance Engine</span>
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="text-2xl font-bold">🛡️ Active</div>
          <p className="text-xs text-slate-500 mt-1">Policies enforced</p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-8">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="font-semibold text-red-400">Connection Error</div>
              <div className="text-sm text-slate-300">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Create Mission */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Create New Mission</h2>

          {/* Preset quick-pick */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 block mb-2">Quick Presets</label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.title}
                  onClick={() => { setTitle(p.title); setGoalX(p.goalX); setGoalY(p.goalY); }}
                  className={`text-left text-xs p-2 rounded-lg border transition ${
                    title === p.title
                      ? "border-cyan-500 bg-cyan-500/10 text-white"
                      : "border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  <span className="mr-1">{p.icon}</span> {p.title}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 block mb-1">Mission Title (LLM Instruction)</label>
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                placeholder="e.g. Deliver pallet to Bay 3"
              />
              <p className="text-[10px] text-slate-500 mt-1">This title is sent to the Gemini LLM as the planning instruction</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-400 block mb-1">Goal X</label>
                <input 
                  type="number"
                  value={goalX}
                  onChange={(e) => setGoalX(Number(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Goal Y</label>
                <input 
                  type="number"
                  value={goalY}
                  onChange={(e) => setGoalY(Number(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
            <button 
              onClick={handleCreate}
              disabled={creating || status.api !== 'connected'}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
            >
              {creating ? 'Creating...' : 'Create Mission'}
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Governance Features</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
              <span className="text-2xl">🛡️</span>
              <div>
                <div className="font-medium">Policy Engine</div>
                <div className="text-xs text-slate-400">Real-time safety checks</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
              <span className="text-2xl">📊</span>
              <div>
                <div className="font-medium">Risk Scoring</div>
                <div className="text-xs text-slate-400">0.70 threshold enforcement</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
              <span className="text-2xl">🔗</span>
              <div>
                <div className="font-medium">Audit Chain</div>
                <div className="text-xs text-slate-400">SHA-256 tamper-proof logs</div>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
              <span className="text-2xl">📋</span>
              <div>
                <div className="font-medium">Compliance Reports</div>
                <div className="text-xs text-slate-400">ISO 42001 & EU AI Act ready</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Missions List — 5 most recent */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Missions</h2>
          {missions.length > 0 && (
            <Link href="/missions" className="text-cyan-400 hover:text-cyan-300 text-sm font-medium transition">
              View all {missions.length} →
            </Link>
          )}
        </div>
        {missions.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <div className="text-4xl mb-2">📭</div>
            <div>No missions yet. Create one above or try the demo!</div>
          </div>
        ) : (
          <div className="space-y-3">
            {missions.slice(0, 5).map((m) => {
              const badge = STATUS_BADGE[m.status] || STATUS_BADGE.draft;
              return (
                <div key={m.id} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{m.title}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      Goal: ({m.goal?.x}, {m.goal?.y}) • {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    {(m.status === "draft" || m.status === "paused") && (
                      <button 
                        onClick={() => handleStartRun(m.id)}
                        disabled={status.api !== 'connected'}
                        className="bg-green-500 hover:bg-green-600 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
                      >
                        {m.status === "paused" ? "Resume & Run" : "Execute"}
                      </button>
                    )}
                    {m.status === "executing" && missionRunIds[m.id] && (
                      <Link
                        href={`/runs/${missionRunIds[m.id]}`}
                        className="bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30 px-4 py-2 rounded-lg font-medium transition text-sm"
                      >
                        View Live →
                      </Link>
                    )}
                    {m.status === "executing" && !missionRunIds[m.id] && (
                      <span className="text-green-400 text-sm font-medium px-3 py-2 animate-pulse">Running...</span>
                    )}
                    {m.status === "completed" && missionRunIds[m.id] && (
                      <Link
                        href={`/runs/${missionRunIds[m.id]}`}
                        className="bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/30 px-4 py-2 rounded-lg font-medium transition text-sm"
                      >
                        View Run →
                      </Link>
                    )}
                    {m.status === "completed" && !missionRunIds[m.id] && (
                      <span className="text-cyan-400 text-sm px-3 py-2">Done</span>
                    )}
                  </div>
                </div>
              );
            })}
            {missions.length > 5 && (
              <div className="text-center pt-2">
                <Link href="/missions" className="text-sm text-cyan-400 hover:text-cyan-300">
                  + {missions.length - 5} more mission{missions.length - 5 !== 1 ? "s" : ""}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Phase E: Analytics & Governance Dashboard */}
      {status.api === 'connected' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          {/* Score Trends (#10) */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-lg font-semibold mb-4">📈 Score Trends</h2>
            {scoreTrends.length === 0 ? (
              <div className="text-slate-400 text-sm text-center py-4">No trend data yet. Complete some runs.</div>
            ) : (
              <div className="space-y-2">
                {scoreTrends.slice(0, 8).map((t: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-mono w-20 truncate">{t.run_id?.slice(0, 8) || `Run ${i+1}`}</span>
                    <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${(t.composite ?? t.score ?? 0) > 0.7 ? "bg-green-500" : (t.composite ?? t.score ?? 0) > 0.4 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${((t.composite ?? t.score ?? 0) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 w-10 text-right">{((t.composite ?? t.score ?? 0) * 100).toFixed(0)}%</span>
                  </div>
                ))}
                {scoreTrends.length > 8 && <div className="text-[10px] text-slate-500 text-center">+{scoreTrends.length - 8} more runs</div>}
              </div>
            )}
          </div>

          {/* Cross-Run Learning (#18) */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-lg font-semibold mb-4">🧠 Cross-Run Learning</h2>
            {!crossRunLearning ? (
              <div className="text-slate-400 text-sm text-center py-4">Loading learning data...</div>
            ) : (
              <div className="space-y-3">
                {crossRunLearning.lessons?.length > 0 ? (
                  crossRunLearning.lessons.slice(0, 5).map((l: any, i: number) => (
                    <div key={i} className="text-xs bg-purple-500/10 border border-purple-500/20 rounded px-3 py-2 text-purple-200">
                      {typeof l === "string" ? l : l.content || l.lesson || JSON.stringify(l)}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400 text-sm text-center py-2">No lessons extracted yet</div>
                )}
                {crossRunLearning.pattern_summary && (
                  <div className="text-[10px] text-slate-400 bg-slate-900/60 rounded p-2">{crossRunLearning.pattern_summary}</div>
                )}
                {crossRunLearning.runs_analyzed != null && (
                  <div className="text-[10px] text-slate-500">{crossRunLearning.runs_analyzed} runs analyzed</div>
                )}
              </div>
            )}
          </div>

          {/* System Integrity (#15) */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-lg font-semibold mb-4">🔒 System Integrity</h2>
            {!crossRunIntegrity ? (
              <div className="text-slate-400 text-sm text-center py-4">Checking integrity...</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    crossRunIntegrity.verdict === "CLEAN" ? "bg-green-500/15 text-green-400 border-green-500/30" :
                    crossRunIntegrity.verdict === "FLAGGED" ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" :
                    "bg-red-500/15 text-red-400 border-red-500/30"
                  }`}>
                    {crossRunIntegrity.verdict === "CLEAN" ? "✓ All Clean" : crossRunIntegrity.verdict || "Unknown"}
                  </span>
                  {crossRunIntegrity.runs_checked != null && (
                    <span className="text-[10px] text-slate-500">{crossRunIntegrity.runs_checked} runs checked</span>
                  )}
                </div>
                {crossRunIntegrity.flagged_runs?.length > 0 && (
                  <div className="space-y-1">
                    {crossRunIntegrity.flagged_runs.map((r: any, i: number) => (
                      <div key={i} className="text-[10px] bg-yellow-500/10 border border-yellow-500/20 rounded px-2 py-1 text-yellow-300">
                        Run {r.run_id?.slice(0, 8)}: {r.issue || "flagged"}
                      </div>
                    ))}
                  </div>
                )}
                {crossRunIntegrity.anomalies?.length > 0 && (
                  <div className="space-y-1">
                    {crossRunIntegrity.anomalies.map((a: any, i: number) => (
                      <div key={i} className="text-[10px] text-red-300 bg-red-500/10 rounded px-2 py-1">{a}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tuning Recommendations (#12, #13) */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-lg font-semibold mb-4">🎛️ Tuning Recommendations</h2>
            {!tuningRecs ? (
              <div className="text-slate-400 text-sm text-center py-4">Loading tuning data...</div>
            ) : (
              <div className="space-y-2">
                {tuningRecs.recommendations?.length > 0 ? (
                  tuningRecs.recommendations.slice(0, 5).map((r: any, i: number) => (
                    <div key={i} className="text-xs bg-cyan-500/10 border border-cyan-500/20 rounded px-3 py-2 text-cyan-200">
                      {typeof r === "string" ? r : (
                        <div>
                          <span className="font-semibold">{r.parameter || r.name}</span>: {r.suggestion || r.value || r.description}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400 text-sm text-center py-2">No recommendations available</div>
                )}
                {tuningRecs.confidence != null && (
                  <div className="text-[10px] text-slate-500">Confidence: {(tuningRecs.confidence * 100).toFixed(0)}%</div>
                )}
              </div>
            )}
          </div>

          {/* Optimization Envelope (#7) */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <h2 className="text-lg font-semibold mb-4">📊 Optimization Envelope</h2>
            {!optimizationEnvelope ? (
              <div className="text-slate-400 text-sm text-center py-4">Loading optimization data...</div>
            ) : (
              <div className="space-y-2">
                {optimizationEnvelope.speed_range && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Speed Range</span>
                    <span className="text-slate-300 font-mono">{optimizationEnvelope.speed_range.min?.toFixed(2)} – {optimizationEnvelope.speed_range.max?.toFixed(2)} m/s</span>
                  </div>
                )}
                {optimizationEnvelope.safety_margin != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Safety Margin</span>
                    <span className="text-slate-300 font-mono">{optimizationEnvelope.safety_margin?.toFixed?.(2) || optimizationEnvelope.safety_margin}m</span>
                  </div>
                )}
                {optimizationEnvelope.constraints && (
                  <div className="text-[10px] text-slate-500 space-y-0.5 mt-1">
                    {Object.entries(optimizationEnvelope.constraints).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span>{k.replace(/_/g, " ")}</span>
                        <span className="font-mono text-slate-400">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
