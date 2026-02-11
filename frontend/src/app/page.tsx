'use client';

import React, { useEffect, useState } from "react";

// API configuration
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

interface Mission {
  id: string;
  title: string;
  goal?: { x: number; y: number };
  created_at: string;
}

interface SystemStatus {
  api: 'connected' | 'disconnected' | 'checking';
  gemini: 'enabled' | 'disabled' | 'unknown';
  database: 'connected' | 'disconnected' | 'unknown';
}

export default function HomePage() {
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

  // Check API health
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) {
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
        const res = await fetch(`${API_URL}/missions`);
        if (res.ok) {
          const data = await res.json();
          setMissions(data);
        }
      } catch (e) {
        console.error('Failed to fetch missions:', e);
      }
    }
    
    fetchMissions();
  }, [status.api]);

  // Create mission
  async function handleCreate() {
    setCreating(true);
    setError(null);
    
    try {
      const res = await fetch(`${API_URL}/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, goal: { x: goalX, y: goalY } })
      });
      
      if (res.ok) {
        const data = await res.json();
        setMissions(prev => [data, ...prev]);
        setTitle("Deliver to Bay 3");
      } else {
        throw new Error('Failed to create mission');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  // Start run
  async function handleStartRun(missionId: string) {
    try {
      const res = await fetch(`${API_URL}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: missionId })
      });
      
      if (res.ok) {
        const data = await res.json();
        window.location.href = `/runs/${data.run_id}`;
      }
    } catch (e) {
      setError('Failed to start run');
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
        <a 
          href="/demo" 
          className="inline-flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition shadow-lg shadow-cyan-500/30"
        >
          🎮 Try Interactive Demo
        </a>
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
          <p className="text-xs text-slate-500 mt-1">{API_URL || 'localhost'}</p>
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
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 block mb-1">Mission Title</label>
              <input 
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-cyan-500"
                placeholder="Deliver to Bay 3"
              />
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

      {/* Missions List */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 className="text-lg font-semibold mb-4">Recent Missions</h2>
        {missions.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <div className="text-4xl mb-2">📭</div>
            <div>No missions yet. Create one above or try the demo!</div>
          </div>
        ) : (
          <div className="space-y-3">
            {missions.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                <div>
                  <div className="font-medium">{m.title}</div>
                  <div className="text-sm text-slate-400">
                    Goal: ({m.goal?.x}, {m.goal?.y}) • {new Date(m.created_at).toLocaleString()}
                  </div>
                </div>
                <button 
                  onClick={() => handleStartRun(m.id)}
                  disabled={status.api !== 'connected'}
                  className="bg-green-500 hover:bg-green-600 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition"
                >
                  Start Run
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
