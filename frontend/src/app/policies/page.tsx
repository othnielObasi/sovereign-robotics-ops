"use client";

import React, { useEffect, useState, useCallback } from "react";
import { listPolicies, testPolicy } from "@/lib/api";

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

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [telemetryText, setTelemetryText] = useState(
    JSON.stringify(
      { x: 14, y: 7, zone: "aisle", nearest_obstacle_m: 0.45, human_detected: true, human_conf: 0.8 },
      null,
      2
    )
  );
  const [proposalText, setProposalText] = useState(
    JSON.stringify(
      { intent: "MOVE_TO", params: { x: 15, y: 7, max_speed: 0.8 }, rationale: "Test action" },
      null,
      2
    )
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [result, setResult] = useState<GovernanceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPolicies(await listPolicies());
      } catch (e: any) {
        setErr("Failed to load policies");
      } finally {
        setLoadingPolicies(false);
      }
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

          {(err || jsonError) && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4 text-sm text-red-400">
              {jsonError || err}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 block mb-1">Telemetry (JSON)</label>
              <textarea
                value={telemetryText}
                onChange={(e) => setTelemetryText(e.target.value)}
                rows={7}
                className="w-full bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-2 text-sm text-green-400 font-mono focus:outline-none focus:border-cyan-500 resize-y"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 block mb-1">Proposal (JSON)</label>
              <textarea
                value={proposalText}
                onChange={(e) => setProposalText(e.target.value)}
                rows={5}
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
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm">Decision:</span>
                <span className={`font-bold text-lg ${decisionColor[result.decision] || "text-white"}`}>
                  {result.decision}
                </span>
              </div>

              <div>
                <span className="text-slate-400 text-sm">Risk Score:</span>
                <span className="font-bold text-white ml-2">
                  {(result.risk_score * 100).toFixed(0)}%
                </span>
              </div>

              <div>
                <span className="text-slate-400 text-sm">Policy Hits:</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {result.policy_hits.length === 0 ? (
                    <span className="text-slate-500 text-sm">None</span>
                  ) : (
                    result.policy_hits.map((h) => (
                      <span key={h} className="bg-red-500/20 text-red-400 text-xs font-mono px-2 py-0.5 rounded border border-red-500/30">
                        {h}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {result.reasons.length > 0 && (
                <div>
                  <span className="text-slate-400 text-sm">Reasons:</span>
                  <ul className="mt-1 text-sm text-slate-300 list-disc list-inside space-y-0.5">
                    {result.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.required_action && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <span className="text-yellow-400 text-xs font-semibold">Required Action</span>
                  <div className="text-sm text-yellow-300 mt-1">{result.required_action}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
