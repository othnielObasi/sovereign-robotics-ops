'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Simulated API responses (same format Gemini will send)
const generateApiResponse = (scenario, robotPos, waypointIndex) => ({
  timestamp: new Date().toISOString(),
  run_id: "run-demo-001",
  robot_state: {
    position: robotPos,
    velocity: scenario.status === 'STOP' ? 0 : scenario.status === 'SLOW' ? 0.3 : 1.0,
    battery: 87,
    status: "operational"
  },
  governance_decision: {
    approved: scenario.status !== 'STOP',
    action: scenario.status,
    risk_score: scenario.risk,
    violations: scenario.status === 'STOP' ? ['human-presence'] : 
                scenario.status === 'SLOW' ? ['speed-limit'] : 
                scenario.status === 'REPLAN' ? ['path-blocked'] : [],
    evaluation_time_ms: Math.floor(Math.random() * 20) + 15,
    policy_version: "v2.1.0"
  },
  audit: {
    hash: Math.random().toString(16).slice(2, 18),
    previous_hash: Math.random().toString(16).slice(2, 18),
    chain_length: Math.floor(Math.random() * 1000) + 500
  },
  waypoint: {
    current: waypointIndex,
    total: scenario.path?.length || 1
  }
});

const scenarios = [
  { 
    name: 'Safe Operation', 
    status: 'SAFE', 
    risk: 0.15, 
    humans: [], 
    obstacles: [], 
    description: 'Robot moves freely to target',
    path: [{ x: 25, y: 50 }, { x: 75, y: 50 }]
  },
  { 
    name: 'Human Approaching', 
    status: 'SLOW', 
    risk: 0.52, 
    humans: [{ x: 55, y: 50 }], 
    obstacles: [], 
    description: 'Speed reduced, safe distance maintained',
    path: [{ x: 25, y: 50 }, { x: 40, y: 50 }],
    stopX: 40
  },
  { 
    name: 'Human Too Close', 
    status: 'STOP', 
    risk: 0.85, 
    humans: [{ x: 35, y: 50 }], 
    obstacles: [], 
    description: 'Emergency halt - human in danger zone',
    path: [{ x: 25, y: 50 }]
  },
  { 
    name: 'Path Blocked', 
    status: 'REPLAN', 
    risk: 0.45, 
    humans: [], 
    obstacles: [{ x: 50, y: 50 }], 
    description: 'Following alternate route',
    path: [
      { x: 25, y: 50 },
      { x: 32, y: 32 },
      { x: 50, y: 20 },
      { x: 68, y: 32 },
      { x: 75, y: 50 }
    ]
  },
];

export default function SovereignDashboard() {
  // Connection state
  const [wsConnected, setWsConnected] = useState(false);
  const [wsConnecting, setWsConnecting] = useState(true);
  const [messagesPerSec, setMessagesPerSec] = useState(0);
  const [latency, setLatency] = useState(0);
  
  // Scenario state
  const [activeScenario, setActiveScenario] = useState(0);
  const [robotPos, setRobotPos] = useState({ x: 25, y: 50 });
  const [waypointIndex, setWaypointIndex] = useState(0);
  const [trail, setTrail] = useState([]);
  const [events, setEvents] = useState([]);
  const [arrived, setArrived] = useState(false);
  const [apiResponse, setApiResponse] = useState(null);
  const [showApiPanel, setShowApiPanel] = useState(true);
  
  const canvasRef = useRef(null);
  const messageCountRef = useRef(0);
  const scenario = scenarios[activeScenario];

  // Simulate WebSocket connection
  useEffect(() => {
    const connectTimer = setTimeout(() => {
      setWsConnecting(false);
      setWsConnected(true);
      addEvent({ ...scenario, description: 'WebSocket connected to governance API' });
    }, 1500);
    
    return () => clearTimeout(connectTimer);
  }, []);

  // Message rate calculator
  useEffect(() => {
    const interval = setInterval(() => {
      setMessagesPerSec(messageCountRef.current);
      messageCountRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const addEvent = (s) => {
    setEvents(prev => [{
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      type: s.status,
      message: s.description,
      risk: s.risk
    }, ...prev].slice(0, 10));
  };

  const handleScenarioChange = (i) => {
    setActiveScenario(i);
    setRobotPos({ x: 25, y: 50 });
    setWaypointIndex(0);
    setTrail([]);
    setArrived(false);
    addEvent(scenarios[i]);
  };

  // Main simulation loop with API response generation
  useEffect(() => {
    if (!wsConnected) return;
    
    const interval = setInterval(() => {
      if (arrived) return;

      const startTime = performance.now();

      setRobotPos(prev => {
        if (scenario.status === 'STOP') return prev;

        const path = scenario.path;
        if (!path || waypointIndex >= path.length) {
          setArrived(true);
          return prev;
        }

        if (scenario.status === 'SLOW' && scenario.stopX && prev.x >= scenario.stopX - 0.5) {
          return prev;
        }

        const target = path[waypointIndex];
        const dx = target.x - prev.x;
        const dy = target.y - prev.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 1.5) {
          if (waypointIndex < path.length - 1) {
            setWaypointIndex(w => w + 1);
          } else {
            setArrived(true);
          }
          return prev;
        }

        let speed = scenario.status === 'SLOW' ? 0.15 : scenario.status === 'REPLAN' ? 0.35 : 0.5;

        const newPos = {
          x: prev.x + (dx / dist) * speed,
          y: prev.y + (dy / dist) * speed
        };

        setTrail(t => [...t.slice(-60), { ...prev }]);
        return newPos;
      });

      // Generate API response
      const response = generateApiResponse(scenario, robotPos, waypointIndex);
      setApiResponse(response);
      messageCountRef.current++;
      
      // Simulate latency
      setLatency(Math.floor(performance.now() - startTime) + response.governance_decision.evaluation_time_ms);

    }, 40);

    return () => clearInterval(interval);
  }, [wsConnected, scenario, waypointIndex, arrived, robotPos]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = '#0D1B2A';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(0,212,255,0.06)';
    for (let x = 0; x <= w; x += 25) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 25) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Path
    if (scenario.path?.length > 1) {
      const color = scenario.status === 'REPLAN' ? '#3b82f6' : scenario.status === 'SLOW' ? '#eab308' : '#22c55e';
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      scenario.path.forEach((p, i) => {
        const px = (p.x / 100) * w, py = (p.y / 100) * h;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      scenario.path.forEach((p, i) => {
        if (i === 0) return;
        const px = (p.x / 100) * w, py = (p.y / 100) * h;
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fillStyle = i <= waypointIndex ? color : 'rgba(255,255,255,0.2)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = i <= waypointIndex ? '#fff' : '#888';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i.toString(), px, py);
      });
    }

    // Stop line
    if (scenario.stopX) {
      const sx = (scenario.stopX / 100) * w;
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, 30);
      ctx.lineTo(sx, h - 30);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#eab308';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⛔ SAFE DISTANCE', sx, 18);
    }

    // Humans
    scenario.humans?.forEach(human => {
      const hx = (human.x / 100) * w, hy = (human.y / 100) * h;
      
      const g1 = ctx.createRadialGradient(hx, hy, 20, hx, hy, 90);
      g1.addColorStop(0, 'rgba(234,179,8,0.25)');
      g1.addColorStop(1, 'transparent');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(hx, hy, 90, 0, Math.PI * 2);
      ctx.fill();

      const g2 = ctx.createRadialGradient(hx, hy, 0, hx, hy, 45);
      g2.addColorStop(0, 'rgba(239,68,68,0.6)');
      g2.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(hx, hy, 45, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(hx, hy, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(hx, hy, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👤', hx, hy);
      ctx.fillStyle = '#f97316';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('HUMAN', hx, hy + 35);
    });

    // Obstacles
    scenario.obstacles?.forEach(obs => {
      const ox = (obs.x / 100) * w, oy = (obs.y / 100) * h;
      const g = ctx.createRadialGradient(ox, oy, 20, ox, oy, 70);
      g.addColorStop(0, 'rgba(239,68,68,0.3)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ox, oy, 70, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ox, oy, 30, 0, Math.PI * 2);
      ctx.fillStyle = '#4a5568';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ox - 14, oy - 14);
      ctx.lineTo(ox + 14, oy + 14);
      ctx.moveTo(ox + 14, oy - 14);
      ctx.lineTo(ox - 14, oy + 14);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('OBSTACLE', ox, oy + 48);
    });

    // Trail
    trail.forEach((p, i) => {
      const a = (i / trail.length) * 0.85;
      const s = 2 + (i / trail.length) * 5;
      ctx.fillStyle = scenario.status === 'REPLAN' ? `rgba(59,130,246,${a})` : `rgba(0,212,255,${a})`;
      ctx.beginPath();
      ctx.arc((p.x / 100) * w, (p.y / 100) * h, s, 0, Math.PI * 2);
      ctx.fill();
    });

    // Target
    const tx = (75 / 100) * w, ty = (50 / 100) * h;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(tx, ty, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(tx - 25, ty); ctx.lineTo(tx + 25, ty);
    ctx.moveTo(tx, ty - 25); ctx.lineTo(tx, ty + 25);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('🎯 TARGET', tx, ty + 36);

    // Robot
    const rx = (robotPos.x / 100) * w, ry = (robotPos.y / 100) * h;
    const robotColor = { SAFE: '#00D4FF', SLOW: '#eab308', STOP: '#ef4444', REPLAN: '#3b82f6' }[scenario.status];
    const glowSize = scenario.status === 'STOP' ? 42 + Math.sin(Date.now() / 80) * 8 : 35;

    const glow = ctx.createRadialGradient(rx, ry, 0, rx, ry, glowSize);
    glow.addColorStop(0, scenario.status === 'STOP' ? 'rgba(239,68,68,0.6)' : `${robotColor}66`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(rx, ry, glowSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(rx, ry, 22, 0, Math.PI * 2);
    ctx.fillStyle = robotColor;
    ctx.fill();
    ctx.strokeStyle = '#0A1929';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = scenario.status === 'SLOW' ? '#000' : '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R1', rx, ry);

    // Badge
    const badge = { SAFE: '#22c55e', SLOW: '#eab308', STOP: '#ef4444', REPLAN: '#3b82f6' }[scenario.status];
    ctx.fillStyle = badge;
    ctx.beginPath();
    ctx.roundRect(rx - 38, ry - 55, 76, 28, 6);
    ctx.fill();
    ctx.fillStyle = scenario.status === 'SLOW' ? '#000' : '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(scenario.status, rx, ry - 41);

  }, [robotPos, trail, scenario, waypointIndex]);

  const statusColor = (s) => ({ SAFE: 'bg-green-500', SLOW: 'bg-yellow-500', STOP: 'bg-red-500', REPLAN: 'bg-blue-500' }[s]);
  const borderColor = (s) => ({ SAFE: 'border-green-500', SLOW: 'border-yellow-500', STOP: 'border-red-500', REPLAN: 'border-blue-500' }[s]);
  const riskColor = (r) => r > 0.7 ? 'text-red-400' : r > 0.4 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="min-h-screen bg-slate-900 text-white p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/30">
            <span className="text-white font-bold text-lg">S</span>
          </div>
          <div>
            <h1 className="text-lg font-bold">Sovereign Robotics Ops</h1>
            <p className="text-xs text-slate-400">Track 1: Autonomous Robotics Control</p>
          </div>
        </div>
        
        {/* Connection Status */}
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            wsConnecting ? 'bg-yellow-500/20 border-yellow-500/30' :
            wsConnected ? 'bg-green-500/20 border-green-500/30' : 'bg-red-500/20 border-red-500/30'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              wsConnecting ? 'bg-yellow-500 animate-pulse' :
              wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
            }`} />
            <span className={`text-xs font-medium ${
              wsConnecting ? 'text-yellow-400' :
              wsConnected ? 'text-green-400' : 'text-red-400'
            }`}>
              {wsConnecting ? 'Connecting...' : wsConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          
          {wsConnected && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>📡 {messagesPerSec} msg/s</span>
              <span>⚡ {latency}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {wsConnecting && (
        <div className="flex items-center justify-center h-96 bg-slate-800 rounded-xl mb-4">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Connecting to Governance API...</p>
            <p className="text-xs text-slate-500 mt-1">ws://localhost:8080/ws/run-demo-001</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      {wsConnected && (
        <>
          {/* Scenarios */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {scenarios.map((s, i) => (
              <button
                key={i}
                onClick={() => handleScenarioChange(i)}
                className={`p-3 rounded-lg border-2 text-left transition-all ${
                  i === activeScenario ? `${borderColor(s.status)} bg-slate-800` : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-3 h-3 rounded-full ${statusColor(s.status)} ${i === activeScenario ? 'animate-pulse' : ''}`} />
                  <span className="font-medium text-sm">{s.name}</span>
                </div>
                <p className="text-xs text-slate-400 truncate">{s.description}</p>
              </button>
            ))}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-12 gap-3">
            {/* Left: Simulation + 3D Placeholder */}
            <div className="col-span-5 space-y-3">
              {/* 2D View */}
              <div className="bg-slate-800 rounded-xl p-3">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-xs font-semibold text-slate-300">2D GOVERNANCE VIEW</h2>
                  <span className="text-xs text-slate-500">Live</span>
                </div>
                <canvas ref={canvasRef} width={400} height={280} className="w-full rounded-lg border border-slate-600" />
              </div>
              
              {/* 3D Placeholder */}
              <div className="bg-slate-800 rounded-xl p-3">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-xs font-semibold text-slate-300">3D SIMULATOR VIEW</h2>
                  <span className="text-xs text-cyan-400">Gemini Robotics 1.5</span>
                </div>
                <div className="h-32 bg-slate-900 rounded-lg border border-slate-600 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-3xl mb-2">🤖</div>
                    <p className="text-xs text-slate-500">Gazebo / Isaac Sim / Gemini Feed</p>
                    <p className="text-xs text-slate-600">Connect simulator to enable</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Center: Metrics */}
            <div className="col-span-3 space-y-3">
              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs text-slate-400 mb-2">STATUS</h3>
                <div className={`text-center py-3 rounded-lg ${statusColor(scenario.status)} ${scenario.status === 'STOP' ? 'animate-pulse' : ''}`}>
                  <span className="text-2xl font-bold">{scenario.status}</span>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs text-slate-400 mb-2">RISK SCORE</h3>
                <div className={`text-4xl font-bold ${riskColor(scenario.risk)}`}>{scenario.risk.toFixed(2)}</div>
                <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full ${scenario.risk > 0.7 ? 'bg-red-500' : scenario.risk > 0.4 ? 'bg-yellow-500' : 'bg-green-500'}`} 
                       style={{ width: `${scenario.risk * 100}%` }} />
                </div>
                <p className="text-xs text-slate-500 mt-1">Threshold: 0.70</p>
              </div>

              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs text-slate-400 mb-2">POLICIES</h3>
                <div className="space-y-1.5 text-xs">
                  {['human-presence', 'speed-governor', 'path-planning'].map((p, i) => {
                    const active = (p === 'human-presence' && scenario.humans?.length) ||
                                   (p === 'speed-governor' && (scenario.status === 'SLOW' || scenario.status === 'STOP')) ||
                                   (p === 'path-planning' && scenario.status === 'REPLAN');
                    const critical = p === 'human-presence' && scenario.status === 'STOP';
                    return (
                      <div key={i} className="flex justify-between">
                        <span className="text-slate-300">{p}</span>
                        <span className={critical ? 'text-red-400' : active ? 'text-yellow-400' : 'text-green-400'}>
                          {critical ? '🛑' : active ? '⚡' : '✓'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs text-slate-400 mb-2">AUDIT</h3>
                <code className="text-xs text-cyan-400 font-mono break-all">
                  {apiResponse?.audit?.hash || '---'}
                </code>
                <p className="text-xs text-slate-500 mt-1">
                  Chain: #{apiResponse?.audit?.chain_length || 0}
                </p>
              </div>
            </div>

            {/* Right: API Response Panel */}
            <div className="col-span-4 space-y-3">
              <div className="bg-slate-800 rounded-xl p-3">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-xs text-slate-400">API RESPONSE</h3>
                  <button 
                    onClick={() => setShowApiPanel(!showApiPanel)}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    {showApiPanel ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showApiPanel && apiResponse && (
                  <pre className="text-xs bg-slate-900 p-2 rounded-lg overflow-auto max-h-64 text-slate-300 font-mono">
{JSON.stringify(apiResponse, null, 2)}
                  </pre>
                )}
              </div>

              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs text-slate-400 mb-2">PERFORMANCE</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-slate-500">Eval Time</p>
                    <p className="text-lg font-bold text-green-400">{apiResponse?.governance_decision?.evaluation_time_ms || 0}ms</p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-slate-500">Round Trip</p>
                    <p className="text-lg font-bold text-cyan-400">{latency}ms</p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-slate-500">Messages</p>
                    <p className="text-lg font-bold text-blue-400">{messagesPerSec}/s</p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-slate-500">Policy Ver</p>
                    <p className="text-lg font-bold text-purple-400">{apiResponse?.governance_decision?.policy_version || 'v2.1.0'}</p>
                  </div>
                </div>
              </div>

              {/* Integration Info */}
              <div className="bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl p-3">
                <h3 className="text-xs text-cyan-400 font-semibold mb-2">🔌 INTEGRATION READY</h3>
                <div className="text-xs text-slate-400 space-y-1">
                  <p>✓ Same API format for all sources</p>
                  <p>✓ Gemini Robotics 1.5 compatible</p>
                  <p>✓ Gazebo / Isaac Sim ready</p>
                  <p>✓ &lt;100ms governance latency</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="col-span-12 bg-slate-800 rounded-xl p-3">
              <h3 className="text-xs text-slate-400 mb-2">DECISION TIMELINE</h3>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {events.map(e => (
                  <div key={e.id} className={`flex-shrink-0 p-2 rounded-lg border text-xs min-w-[160px] ${
                    e.type === 'STOP' ? 'bg-red-500/10 border-red-500/30' :
                    e.type === 'SLOW' ? 'bg-yellow-500/10 border-yellow-500/30' :
                    e.type === 'REPLAN' ? 'bg-blue-500/10 border-blue-500/30' :
                    'bg-green-500/10 border-green-500/30'
                  }`}>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-400">{e.time}</span>
                      <span className={`font-bold px-1.5 py-0.5 rounded ${statusColor(e.type)}`}>{e.type}</span>
                    </div>
                    <p className="text-slate-300 truncate">{e.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between text-xs text-slate-500">
        <span>Sovereign AI Labs • Runtime Governance Layer</span>
        <span>Ready for Gemini Robotics 1.5 API</span>
      </div>
    </div>
  );
}
