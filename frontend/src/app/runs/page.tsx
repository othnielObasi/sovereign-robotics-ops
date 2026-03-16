"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { listRuns } from "@/lib/api";

type RunInfo = {
  id: string;
  mission_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  running:   { label: "Running",   cls: "bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse" },
  stopped:   { label: "Stopped",   cls: "bg-red-500/20 text-red-400 border border-red-500/30" },
  completed: { label: "Completed", cls: "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" },
};

export default function RunsPage() {
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "completed" | "stopped">("all");

  useEffect(() => {
    (async () => {
      try {
        const data = await listRuns();
        setRuns(data);
      } catch (e: any) {
        setError(e.message || "Failed to load runs");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = filter === "all" ? runs : runs.filter((r) => r.status === filter);

  function duration(r: RunInfo): string {
    if (!r.started_at) return "—";
    const start = new Date(r.started_at).getTime();
    const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
    const secs = Math.floor((end - start) / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}m ${rem}s`;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">All Runs</h1>
          <p className="text-sm text-slate-400 mt-1">
            {runs.length} run{runs.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <Link
          href="/missions"
          className="text-sm text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 px-3 py-1.5 rounded-lg transition"
        >
          ← Missions
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["all", "running", "completed", "stopped"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filter === f
                ? "bg-cyan-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-6 text-sm text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline text-xs">dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="animate-pulse">Loading runs...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-5xl mb-3">🤖</div>
          <p className="text-lg font-medium mb-2">No {filter !== "all" ? filter : ""} runs found</p>
          <p className="text-sm text-slate-600">Execute a mission to create a run</p>
          <Link
            href="/missions"
            className="inline-block mt-4 bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
          >
            Go to Missions
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const badge = STATUS_BADGE[r.status] || { label: r.status, cls: "bg-slate-700 text-slate-400 border border-slate-600" };
            return (
              <Link
                key={r.id}
                href={`/runs/${r.id}`}
                className="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-cyan-500/40 hover:bg-slate-800/90 transition group"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-sm font-semibold text-cyan-400 group-hover:text-cyan-300 transition">{r.id}</span>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-slate-400">
                      <span className="font-mono text-xs text-slate-500">{r.mission_id}</span>
                      <span>Started {new Date(r.started_at).toLocaleString()}</span>
                      <span className="text-slate-500">Duration: {duration(r)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {r.status === "running" && (
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    )}
                    <span className="text-slate-500 group-hover:text-cyan-400 transition text-sm">
                      View →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
