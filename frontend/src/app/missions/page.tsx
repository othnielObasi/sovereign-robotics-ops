"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listMissions, createMission, startRun } from "@/lib/api";
import { useRouter } from "next/navigation";
import type { Mission } from "@/lib/types";

export default function MissionsPage() {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMissions(await listMissions());
      } catch {
        setError("Failed to load missions");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleStartRun(missionId: string) {
    try {
      const data = await startRun(missionId);
      router.push(`/runs/${data.run_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to start run");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Missions</h1>
        <Link
          href="/"
          className="bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + New Mission
        </Link>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-6 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading missions...</div>
      ) : missions.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-2">📭</div>
          <div>No missions yet. Create one from the Dashboard.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {missions.map((m) => (
            <div key={m.id} className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="font-semibold text-white">{m.title}</div>
                <div className="text-sm text-slate-400 mt-1">
                  <span className="font-mono text-xs text-slate-500">{m.id}</span>
                  {m.goal && <span className="ml-3">Goal: ({m.goal.x}, {m.goal.y})</span>}
                  <span className="ml-3">{new Date(m.created_at).toLocaleString()}</span>
                </div>
              </div>
              <button
                onClick={() => handleStartRun(m.id)}
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
              >
                Start Run
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
