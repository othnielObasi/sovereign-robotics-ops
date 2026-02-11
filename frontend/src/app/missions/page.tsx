"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  listMissions,
  startRun,
  updateMission,
  deleteMission,
  pauseMission,
  resumeMission,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import type { Mission, MissionStatus } from "@/lib/types";

const STATUS_BADGE: Record<MissionStatus, { label: string; cls: string }> = {
  draft:     { label: "Draft",      cls: "bg-slate-600 text-slate-200" },
  executing: { label: "Executing",  cls: "bg-green-600 text-white animate-pulse" },
  paused:    { label: "Paused",     cls: "bg-yellow-600 text-white" },
  completed: { label: "Completed",  cls: "bg-cyan-700 text-white" },
  deleted:   { label: "Deleted",    cls: "bg-red-800 text-red-200" },
};

export default function MissionsPage() {
  const router = useRouter();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGoalX, setEditGoalX] = useState(0);
  const [editGoalY, setEditGoalY] = useState(0);
  const [filter, setFilter] = useState<"all" | MissionStatus>("all");

  async function reload() {
    try {
      setMissions(await listMissions());
    } catch {
      setError("Failed to load missions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function handleStartRun(missionId: string) {
    try {
      const data = await startRun(missionId);
      router.push(`/runs/${data.run_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to start run");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this mission?")) return;
    try {
      await deleteMission(id);
      setMissions((prev) => prev.filter((m) => m.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handlePause(id: string) {
    try {
      const updated = await pauseMission(id);
      setMissions((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleResume(id: string) {
    try {
      const updated = await resumeMission(id);
      setMissions((prev) => prev.map((m) => (m.id === id ? updated : m)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function startEdit(m: Mission) {
    setEditingId(m.id);
    setEditTitle(m.title);
    setEditGoalX(m.goal?.x ?? 0);
    setEditGoalY(m.goal?.y ?? 0);
  }

  async function saveEdit(id: string) {
    try {
      const updated = await updateMission(id, {
        title: editTitle,
        goal: { x: editGoalX, y: editGoalY },
      });
      setMissions((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setEditingId(null);
    } catch (e: any) {
      setError(e.message);
    }
  }

  const filtered = filter === "all" ? missions : missions.filter((m) => m.status === filter);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">All Missions</h1>
          <p className="text-sm text-slate-400 mt-1">
            {missions.length} mission{missions.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <Link
          href="/"
          className="bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + New Mission
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(["all", "draft", "executing", "paused", "completed"] as const).map((f) => (
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
        <div className="text-center py-12 text-slate-400">Loading missions...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-2">📭</div>
          <div>No {filter !== "all" ? filter : ""} missions found.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => {
            const badge = STATUS_BADGE[m.status] || STATUS_BADGE.draft;
            const isEditing = editingId === m.id;
            const editable = m.status === "draft" || m.status === "paused";

            return (
              <div
                key={m.id}
                className="bg-slate-800 border border-slate-700 rounded-xl p-5"
              >
                {isEditing ? (
                  /* Inline edit form */
                  <div className="space-y-3">
                    <input
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cyan-500"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Mission title"
                    />
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-slate-400">Goal X</label>
                        <input
                          type="number"
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm"
                          value={editGoalX}
                          onChange={(e) => setEditGoalX(Number(e.target.value))}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-slate-400">Goal Y</label>
                        <input
                          type="number"
                          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm"
                          value={editGoalY}
                          onChange={(e) => setEditGoalY(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(m.id)}
                        className="bg-cyan-500 hover:bg-cyan-600 text-white text-xs font-semibold px-4 py-2 rounded-lg"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-slate-600 hover:bg-slate-500 text-white text-xs px-4 py-2 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Normal view */
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white truncate">{m.title}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-sm text-slate-400">
                        <span className="font-mono text-xs text-slate-500">{m.id}</span>
                        {m.goal && (
                          <span className="ml-3">
                            Goal: ({m.goal.x}, {m.goal.y})
                          </span>
                        )}
                        <span className="ml-3">
                          {new Date(m.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {editable && (
                        <button
                          onClick={() => startEdit(m)}
                          className="text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded border border-slate-600 hover:border-slate-500 transition"
                          title="Edit"
                        >
                          ✏️ Edit
                        </button>
                      )}
                      {m.status === "draft" && (
                        <button
                          onClick={() => handleStartRun(m.id)}
                          className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium transition text-xs"
                        >
                          ▶ Execute
                        </button>
                      )}
                      {m.status === "executing" && (
                        <button
                          onClick={() => handlePause(m.id)}
                          className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1.5 rounded-lg font-medium transition text-xs"
                        >
                          ⏸ Pause
                        </button>
                      )}
                      {m.status === "paused" && (
                        <>
                          <button
                            onClick={() => handleResume(m.id)}
                            className="bg-cyan-500 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg font-medium transition text-xs"
                          >
                            ▶ Resume
                          </button>
                          <button
                            onClick={() => handleStartRun(m.id)}
                            className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium transition text-xs"
                          >
                            🔄 Re-run
                          </button>
                        </>
                      )}
                      {(m.status === "draft" || m.status === "paused" || m.status === "completed") && (
                        <button
                          onClick={() => handleDelete(m.id)}
                          className="text-red-400 hover:text-red-300 text-xs px-2 py-1.5 rounded border border-red-800 hover:border-red-600 transition"
                          title="Delete"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
