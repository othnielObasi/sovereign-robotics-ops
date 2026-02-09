"use client";

import React, { useEffect, useState } from "react";
import { createMission, listMissions, startRun } from "@/lib/api";
import type { Mission } from "@/lib/types";

export default function Page() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [title, setTitle] = useState("Deliver to Bay 3");
  const [goalX, setGoalX] = useState(15);
  const [goalY, setGoalY] = useState(7);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setErr(null);
    try {
      const ms = await listMissions();
      setMissions(ms);
    } catch (e: any) {
      setErr(e.message || "Failed");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate() {
    setErr(null);
    try {
      await createMission({ title, goal: { x: Number(goalX), y: Number(goalY) } });
      await refresh();
    } catch (e: any) {
      setErr(e.message || "Failed");
    }
  }

  async function onStart(m: Mission) {
    setErr(null);
    try {
      const r = await startRun(m.id);
      window.location.href = `/runs/${r.run_id}`;
    } catch (e: any) {
      setErr(e.message || "Failed");
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <h2 style={{ marginTop: 0 }}>Missions</h2>

      {err && <div style={{ background: "#fee", padding: 12, border: "1px solid #f99", borderRadius: 8 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px", gap: 8, marginTop: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Mission title" />
        <input type="number" value={goalX} onChange={(e) => setGoalX(Number(e.target.value))} />
        <input type="number" value={goalY} onChange={(e) => setGoalY(Number(e.target.value))} />
        <button onClick={onCreate}>Create</button>
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 12 }}>
        {missions.length === 0 ? (
          <div>No missions yet. Create one above.</div>
        ) : (
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th>Title</th>
                <th>Goal</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid #f3f3f3" }}>
                  <td><b>{m.title}</b><div style={{ fontSize: 12, color: "#666" }}>{m.id}</div></td>
                  <td>({m.goal?.x}, {m.goal?.y})</td>
                  <td style={{ fontSize: 12, color: "#666" }}>{new Date(m.created_at).toLocaleString()}</td>
                  <td><button onClick={() => onStart(m)}>Start Run</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
        Tip: Start a run and open the timeline. You'll see propose → govern → execute events in real time.
      </div>
    </div>
  );
}
