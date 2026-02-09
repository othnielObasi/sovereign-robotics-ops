"use client";

import React, { useEffect, useState } from "react";
import { listPolicies, testPolicy } from "@/lib/api";

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [telemetry, setTelemetry] = useState<any>({
    x: 14,
    y: 7,
    zone: "aisle",
    nearest_obstacle_m: 0.45,
    human_detected: true,
    human_conf: 0.8
  });
  const [proposal, setProposal] = useState<any>({
    intent: "MOVE_TO",
    params: { x: 15, y: 7, max_speed: 0.8 },
    rationale: "Test action"
  });
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setPolicies(await listPolicies());
    })();
  }, []);

  async function onTest() {
    setErr(null);
    try {
      const r = await testPolicy({ telemetry, proposal });
      setResult(r);
    } catch (e: any) {
      setErr(e.message || "Failed");
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 style={{ marginTop: 0 }}>Policies</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Active policies</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {policies.map((p) => (
              <li key={p.policy_id}>
                <b>{p.policy_id}</b> — {p.name} <span style={{ color: "#666" }}>({p.severity})</span>
                <div style={{ color: "#666", fontSize: 12 }}>{p.description}</div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Test action against policies</div>

          {err && <div style={{ background: "#fee", padding: 12, border: "1px solid #f99", borderRadius: 8 }}>{err}</div>}

          <div style={{ fontSize: 12, color: "#666" }}>Telemetry</div>
          <textarea
            value={JSON.stringify(telemetry, null, 2)}
            onChange={(e) => setTelemetry(JSON.parse(e.target.value))}
            rows={8}
            style={{ width: "100%", fontFamily: "monospace" }}
          />

          <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Proposal</div>
          <textarea
            value={JSON.stringify(proposal, null, 2)}
            onChange={(e) => setProposal(JSON.parse(e.target.value))}
            rows={8}
            style={{ width: "100%", fontFamily: "monospace" }}
          />

          <button onClick={onTest} style={{ marginTop: 8 }}>Test</button>

          {result && (
            <div style={{ marginTop: 10 }}>
              <div><b>Decision:</b> {result.decision}</div>
              <div><b>Policy hits:</b> {(result.policy_hits || []).join(", ") || "—"}</div>
              <div><b>Reasons:</b>
                <ul>
                  {(result.reasons || []).map((r: string, idx: number) => <li key={idx}>{r}</li>)}
                </ul>
              </div>
              {result.required_action && (
                <div style={{ background: "#fff7e6", border: "1px solid #ffe0a3", padding: 8, borderRadius: 8 }}>
                  <b>Required action:</b> {result.required_action}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
