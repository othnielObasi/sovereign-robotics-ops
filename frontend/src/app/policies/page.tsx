"use client";

import React, { useEffect, useState, useCallback } from "react";
import { listPolicies, testPolicy, getPolicyVersions, getPolicyClassification, runAdversarialValidation } from "@/lib/api";

interface Policy {
  policy_id: string;
  name: string;
  description: string;
  severity: string;
}

interface GovernanceResult {
  decision: string;
  policy_hits: string[];
  reasons: string[];
  required_action?: string;
  risk_score: number;
}

const PRESETS = [
  {
    label: "🟢 Safe — No human nearby",
    telemetry: { x: 14, y: 7, zone: "aisle", nearest_obstacle_m: 2.0, human_detected: false, human_conf: 0.0 },
    proposal: { intent: "MOVE_TO", params: { x: 15, y: 7, max_speed: 0.5 }, rationale: "Safe movement" },
  },
  {
    label: "🟡 Human nearby — Should slow",
    telemetry: { x: 14, y: 7, zone: "aisle", nearest_obstacle_m: 1.5, human_detected: true, human_conf: 0.85, human_distance_m: 2.5 },
    proposal: { intent: "MOVE_TO", params: { x: 15, y: 7, max_speed: 0.8 }, rationale: "Approach target" },
  },
  {
    label: "🔴 Critical — Human at 0.8m",
    telemetry: { x: 14, y: 7, zone: "loading_bay", nearest_obstacle_m: 0.45, human_detected: true, human_conf: 0.95, human_distance_m: 0.8 },
    proposal: { intent: "MOVE_TO", params: { x: 15, y: 7, max_speed: 0.8 }, rationale: "High speed near human" },
  },
  {
    label: "🚧 Path blocked — Obstacle ahead",
    telemetry: { x: 14, y: 7, zone: "aisle", nearest_obstacle_m: 0.3, human_detected: false, human_conf: 0.0 },
    proposal: { intent: "MOVE_TO", params: { x: 14.5, y: 7, max_speed: 0.6 }, rationale: "Move through tight space" },
  },
];

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [telemetryText, setTelemetryText] = useState(
    JSON.stringify(PRESETS[0].telemetry, null, 2)
  );
  const [proposalText, setProposalText] = useState(
    JSON.stringify(PRESETS[0].proposal, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [result, setResult] = useState<GovernanceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Phase E: policy versions, classification, adversarial
  const [policyVersions, setPolicyVersions] = useState<any[]>([]);
  const [policyClassification, setPolicyClassification] = useState<any>(null);
  const [adversarialResults, setAdversarialResults] = useState<any>(null);
  const [adversarialLoading, setAdversarialLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPolicies(await listPolicies());
      } catch (e: any) {
        setErr("Failed to load policies");
      } finally {
        setLoadingPolicies(false);
      }
      // Phase E data
      try { setPolicyVersions(await getPolicyVersions()); } catch (_) {}
      try { setPolicyClassification(await getPolicyClassification()); } catch (_) {}
    })();
  }, []);

  const onTest = useCallback(async () => {
    setErr(null);
    setJsonError(null);

    let telemetry: any;
    let proposal: any;
    try {
      telemetry = JSON.parse(telemetryText);
    } catch {
      setJsonError("Invalid JSON in Telemetry field");
      return;
    }
    try {
      proposal = JSON.parse(proposalText);
    } catch {
      setJsonError("Invalid JSON in Proposal field");
      return;
    }

    setTesting(true);
    try {
      const r = await testPolicy({ telemetry, proposal });
      setResult(r);
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setTesting(false);
    }
  }, [telemetryText, proposalText]);

  const severityColor: Record<string, string> = {
    HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    LOW: "bg-green-500/20 text-green-400 border-green-500/30",
  };

  const decisionColor: Record<string, string> = {
    APPROVED: "text-green-400",
    DENIED: "text-red-400",
    NEEDS_REVIEW: "text-yellow-400",
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Governance Policies</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Policies */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Active Policies</h2>
          {loadingPolicies ? (
            <div className="text-slate-400 py-4 text-center">Loading...</div>
          ) : policies.length === 0 ? (
            <div className="text-slate-400 py-4 text-center">No policies loaded</div>
          ) : (
            <div className="space-y-3">
              {policies.map((p) => (
                <div key={p.policy_id} className="p-3 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm font-semibold text-cyan-400">{p.policy_id}</span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                        severityColor[p.severity] || severityColor.MEDIUM
                      }`}
                    >
                      {p.severity}
                    </span>
                  </div>
                  <div className="font-medium text-sm text-white">{p.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{p.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Panel */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Test Action Against Policies</h2>

          {/* Preset Scenarios */}
          <div className="mb-4">
            <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold block mb-2">Quick Scenarios</label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => {
                    setTelemetryText(JSON.stringify(preset.telemetry, null, 2));
                    setProposalText(JSON.stringify(preset.proposal, null, 2));
                    setResult(null);
                  }}
                  className="text-left text-xs font-medium px-3 py-2 rounded-lg border border-slate-600 hover:border-cyan-500/40 hover:bg-slate-700/50 transition text-slate-300"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {(err || jsonError) && (
            <div className="bg-red-500/20 border-l-4 border-red-500 rounded-lg p-3 mb-4 text-sm text-red-400">
              {jsonError || err}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 block mb-1">Telemetry (JSON)</label>
              <textarea
                value={telemetryText}
                onChange={(e) => setTelemetryText(e.target.value)}
                rows={6}
                className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-green-400 font-mono focus:outline-none focus:border-cyan-500 resize-y"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 block mb-1">Proposal (JSON)</label>
              <textarea
                value={proposalText}
                onChange={(e) => setProposalText(e.target.value)}
                rows={4}
                className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-green-400 font-mono focus:outline-none focus:border-cyan-500 resize-y"
              />
            </div>

            <button
              onClick={onTest}
              disabled={testing}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition"
            >
              {testing ? "Testing..." : "Test Policy"}
            </button>
          </div>

          {result && (
            <div className="mt-6 space-y-4">
              {/* Decision banner */}
              <div className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                result.decision === "APPROVED" ? "bg-green-500/10 border-green-500/30" :
                result.decision === "DENIED" ? "bg-red-500/10 border-red-500/30" :
                "bg-yellow-500/10 border-yellow-500/30"
              }`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {result.decision === "APPROVED" ? "✅" : result.decision === "DENIED" ? "❌" : "⚠️"}
                  </span>
                  <span className={`font-bold text-xl ${decisionColor[result.decision] || "text-white"}`}>
                    {result.decision}
                  </span>
                </div>
              </div>

              {/* Risk Gauge */}
              <div className="bg-slate-700/40 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-400 font-medium">Risk Score</span>
                  <span className={`text-2xl font-bold ${
                    result.risk_score > 0.7 ? "text-red-400" : result.risk_score > 0.3 ? "text-yellow-400" : "text-green-400"
                  }`}>{(result.risk_score * 100).toFixed(0)}%</span>
                </div>
                <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      result.risk_score > 0.7 ? "bg-gradient-to-r from-red-600 to-red-400" :
                      result.risk_score > 0.3 ? "bg-gradient-to-r from-yellow-600 to-yellow-400" :
                      "bg-gradient-to-r from-green-600 to-green-400"
                    }`}
                    style={{ width: `${Math.max(result.risk_score * 100, 2)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Safe</span>
                  <span>Caution</span>
                  <span>Danger</span>
                </div>
              </div>

              {/* Policy Hits */}
              <div>
                <span className="text-sm text-slate-400 font-medium">Policy Hits</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {result.policy_hits.length === 0 ? (
                    <span className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-lg">✓ No policy violations</span>
                  ) : (
                    result.policy_hits.map((h) => (
                      <span key={h} className="bg-red-500/15 text-red-400 text-sm font-mono px-3 py-1.5 rounded-lg border border-red-500/30 font-semibold">
                        ✗ {h}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Reasons */}
              {result.reasons.length > 0 && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Reasons</span>
                  <ul className="mt-2 text-sm text-slate-300 space-y-1.5">
                    {result.reasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Required Action */}
              {result.required_action && (
                <div className="bg-yellow-500/10 border-l-4 border-yellow-500 rounded-lg p-4">
                  <span className="text-yellow-400 text-xs font-bold uppercase tracking-wider">Required Action</span>
                  <div className="text-base text-yellow-300 mt-1 font-medium">{result.required_action}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Phase E: Policy Versions, Classification, Adversarial Validation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Policy Classification (#14) */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Policy Classification</h2>
          {!policyClassification ? (
            <div className="text-slate-400 text-sm text-center py-4">Loading...</div>
          ) : (
            <div className="space-y-2">
              {policyClassification.categories ? (
                Object.entries(policyClassification.categories).map(([cat, policies]: [string, any]) => (
                  <div key={cat} className="bg-slate-700/50 rounded-lg p-3">
                    <div className="text-sm font-semibold text-cyan-400 mb-1 capitalize">{cat.replace(/_/g, " ")}</div>
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(policies) ? policies : []).map((p: any, i: number) => (
                        <span key={i} className="text-[10px] bg-slate-600 text-slate-300 px-2 py-0.5 rounded font-mono">
                          {typeof p === "string" ? p : p.policy_id || p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-slate-400 bg-slate-900/60 rounded p-2 whitespace-pre-wrap">
                  {JSON.stringify(policyClassification, null, 2)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Policy Version History (#16) */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Version History</h2>
          {policyVersions.length === 0 ? (
            <div className="text-slate-400 text-sm text-center py-4">No version history</div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {policyVersions.map((v: any, i: number) => (
                <div key={i} className="bg-slate-700/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-mono text-cyan-400">{v.policy_id || v.id}</span>
                    <span className="text-[10px] bg-slate-600 text-slate-300 px-2 py-0.5 rounded">v{v.version || i + 1}</span>
                  </div>
                  {v.changed_at && <div className="text-[10px] text-slate-500">{new Date(v.changed_at).toLocaleString()}</div>}
                  {v.change_reason && <div className="text-xs text-slate-400 mt-1">{v.change_reason}</div>}
                  {v.diff_summary && <div className="text-[10px] text-amber-400 mt-1 font-mono">{v.diff_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Adversarial Validation (#15) */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h2 className="text-lg font-semibold mb-4">Adversarial Validation</h2>
          {!adversarialResults ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Run adversarial scenarios to test policy robustness.</p>
              <button
                onClick={async () => {
                  setAdversarialLoading(true);
                  try { setAdversarialResults(await runAdversarialValidation()); } catch (e: any) { setErr(e.message); }
                  setAdversarialLoading(false);
                }}
                disabled={adversarialLoading}
                className="w-full bg-red-500/80 hover:bg-red-600 disabled:bg-slate-600 text-white font-semibold py-2.5 rounded-lg transition text-sm"
              >
                {adversarialLoading ? "Running..." : "🔴 Run Adversarial Tests"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
                  adversarialResults.all_passed ? "bg-green-500/15 text-green-400 border-green-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"
                }`}>
                  {adversarialResults.all_passed ? "✓ All Passed" : "✗ Issues Found"}
                </span>
                <span className="text-[10px] text-slate-500">
                  {adversarialResults.passed || 0}/{adversarialResults.total || 0} passed
                </span>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {(adversarialResults.results || adversarialResults.scenarios || []).map((r: any, i: number) => (
                  <div key={i} className={`text-[10px] rounded px-2 py-1.5 border ${
                    r.passed ? "bg-green-500/10 border-green-500/20 text-green-300" : "bg-red-500/10 border-red-500/20 text-red-300"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{r.scenario_id || r.name || `Test ${i + 1}`}</span>
                      <span>{r.passed ? "✓" : "✗"}</span>
                    </div>
                    {r.description && <div className="text-slate-400 mt-0.5">{r.description}</div>}
                    {r.expected_decision && <div className="text-slate-500">Expected: {r.expected_decision} | Got: {r.actual_decision || "?"}</div>}
                  </div>
                ))}
              </div>
              <button onClick={() => setAdversarialResults(null)} className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition mt-2">
                ↺ Run Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
