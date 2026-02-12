"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/* ── Colour palette ────────────────────────────────────────────── */
const C = {
  floor: "#1a1f2e",
  floorAisle: "#1e2436",
  floorBay: "#1a2a1f",
  gridLine: "rgba(100,116,139,0.12)",
  gridMajor: "rgba(100,116,139,0.25)",
  border: "#334155",
  shelf: "#374151",
  shelfTop: "#4b5563",
  obstacle: "#dc2626",
  obsBorder: "#991b1b",
  human: "#f59e0b",
  humanDanger: "rgba(239,68,68,0.20)",
  humanCaution: "rgba(245,158,11,0.10)",
  robot: "#06b6d4",
  robotDark: "#0e7490",
  robotGlow: "rgba(6,182,212,0.25)",
  path: "#3b82f6",
  target: "#10b981",
  plan: "#a855f7",
  zoneLabel: "rgba(148,163,184,0.50)",
  text: "#cbd5e1",
  textDim: "#64748b",
};

/**
 * Warehouse-style 2D operator map.
 *
 * Dark floor, zone differentiation, shelf racks, risk heatmap,
 * robot with heading + safety radius, human with proximity rings,
 * obstacle crates, path preview, LLM plan waypoints, trail, HUD.
 */
export function Map2D({
  world,
  telemetry,
  pathPoints,
  planWaypoints,
  showHeatmap = true,
  showTrail = true,
  safetyState = "OK",
}: {
  world: any | null;
  telemetry: any | null;
  pathPoints: Array<Pt> | null;
  planWaypoints?: Array<Pt & { max_speed?: number }> | null;
  showHeatmap?: boolean;
  showTrail?: boolean;
  safetyState?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const W = 600,
    H = 380;

  const geo = world?.geofence ?? { min_x: 0, max_x: 40, min_y: 0, max_y: 25 };
  const zones: any[] = world?.zones ?? [];
  const obstacles: any[] = world?.obstacles ?? [];
  const human = world?.human ?? null;
  const walkingHumans: any[] = telemetry?.walking_humans ?? world?.walking_humans ?? [];
  const idleRobots: any[] = telemetry?.idle_robots ?? world?.idle_robots ?? [];
  const bays: any[] = world?.bays ?? [];

  const baseScale = useMemo(() => {
    const wx = (geo.max_x - geo.min_x) || 1;
    const wy = (geo.max_y - geo.min_y) || 1;
    return Math.min((W - 40) / wx, (H - 40) / wy);
  }, [geo]);

  const pad = useMemo(
    () => ({
      x: (W - (geo.max_x - geo.min_x) * baseScale) / 2,
      y: (H - (geo.max_y - geo.min_y) * baseScale) / 2,
    }),
    [baseScale, geo],
  );

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);

  const dragging = useRef(false);
  const lastMouse = useRef<Pt | null>(null);
  const trailRef = useRef<Pt[]>([]);

  /* pulse timer */
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60);
    return () => clearInterval(id);
  }, []);

  /* ── Coordinate helpers ────────────────────────────────────── */
  function w2c(p: Pt) {
    const sx = pad.x + (p.x - geo.min_x) * baseScale;
    const sy = H - pad.y - (p.y - geo.min_y) * baseScale;
    return { x: sx * zoom + pan.x, y: sy * zoom + pan.y };
  }
  function c2w(p: Pt) {
    const sx = (p.x - pan.x) / Math.max(zoom, 1e-6);
    const sy = (p.y - pan.y) / Math.max(zoom, 1e-6);
    return {
      x: (sx - pad.x) / baseScale + geo.min_x,
      y: (H - pad.y - sy) / baseScale + geo.min_y,
    };
  }

  /* ── Pointer interactions (zoom + pan) ────────────────────── */
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const f = e.deltaY > 0 ? 0.9 : 1.1;
      const before = c2w({ x: cx, y: cy });
      const nz = clamp(zoom * f, 0.6, 6);
      setZoom(nz);
      const sx = pad.x + (before.x - geo.min_x) * baseScale;
      const sy = H - pad.y - (before.y - geo.min_y) * baseScale;
      setPan({ x: cx - sx * nz, y: cy - sy * nz });
    };
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !lastMouse.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      lastMouse.current = null;
      try { cv.releasePointerCapture(e.pointerId); } catch {}
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    return () => {
      cv.removeEventListener("wheel", onWheel as any);
      cv.removeEventListener("pointerdown", onDown as any);
      cv.removeEventListener("pointermove", onMove as any);
      cv.removeEventListener("pointerup", onUp as any);
      cv.removeEventListener("pointercancel", onUp as any);
    };
  }, [zoom, baseScale, geo.min_x, geo.min_y, pad]);

  /* ── Trail accumulation ────────────────────────────────────── */
  useEffect(() => {
    if (!telemetry) return;
    const next = { x: Number(telemetry.x ?? 0), y: Number(telemetry.y ?? 0) };
    const t = trailRef.current;
    const last = t.length ? t[t.length - 1] : null;
    if (!last || dist(last, next) > 0.03) {
      t.push(next);
      if (t.length > 300) t.splice(0, t.length - 300);
    }
  }, [telemetry]);

  /* ════════════════════════════════════════════════════════════ */
  /*  MAIN DRAW                                                  */
  /* ════════════════════════════════════════════════════════════ */
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const pulse = Math.sin(tick * 0.12) * 0.5 + 0.5;

    /* background */
    ctx.fillStyle = C.floor;
    ctx.fillRect(0, 0, W, H);

    /* ── zones ──────────────────────────────────────────────── */
    for (const z of zones) {
      const r = z.rect;
      if (!r) continue;
      const tl = w2c({ x: r.min_x, y: r.max_y });
      const br = w2c({ x: r.max_x, y: r.min_y });
      const zw = br.x - tl.x,
        zh = br.y - tl.y;

      if (z.name === "loading_bay") {
        ctx.fillStyle = C.floorBay;
        ctx.fillRect(tl.x, tl.y, zw, zh);
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = "rgba(245,158,11,0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(br.x, tl.y);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = C.floorAisle;
        ctx.fillRect(tl.x, tl.y, zw, zh);
      }
      ctx.fillStyle = C.zoneLabel;
      ctx.font = `bold ${Math.max(10, 12 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(z.name.toUpperCase().replace("_", " "), tl.x + zw / 2, tl.y + zh / 2);
    }

    /* ── warehouse bays (docks & shelves) ───────────────────── */
    for (const bay of bays) {
      if (typeof bay.x !== "number") continue;
      const p = w2c({ x: +bay.x, y: +bay.y });
      const isDock = bay.type === "dock";
      const bw = isDock ? 4 * baseScale * zoom : 1.5 * baseScale * zoom;
      const bh = isDock ? 1.2 * baseScale * zoom : 3 * baseScale * zoom;

      if (isDock) {
        /* dock bay — wide rectangle at top wall */
        ctx.fillStyle = "rgba(245,158,11,0.08)";
        ctx.strokeStyle = "rgba(245,158,11,0.35)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(p.x - bw / 2, p.y - bh / 2, bw, bh, 2);
        ctx.fill();
        ctx.stroke();

        /* dock chevron markers */
        ctx.strokeStyle = "rgba(245,158,11,0.25)";
        ctx.lineWidth = 1;
        for (let ci = -1; ci <= 1; ci += 2) {
          ctx.beginPath();
          ctx.moveTo(p.x + ci * bw * 0.15, p.y - bh * 0.3);
          ctx.lineTo(p.x + ci * bw * 0.25, p.y);
          ctx.lineTo(p.x + ci * bw * 0.15, p.y + bh * 0.3);
          ctx.stroke();
        }
      } else {
        /* shelf bay — narrow vertical rectangle on walls */
        ctx.fillStyle = "rgba(100,116,139,0.1)";
        ctx.strokeStyle = "rgba(100,116,139,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(p.x - bw / 2, p.y - bh / 2, bw, bh, 1);
        ctx.fill();
        ctx.stroke();

        /* shelf lines */
        for (let s = 0.25; s < 1; s += 0.25) {
          const sy = p.y - bh / 2 + bh * s;
          ctx.strokeStyle = "rgba(100,116,139,0.2)";
          ctx.beginPath();
          ctx.moveTo(p.x - bw / 2 + 1, sy);
          ctx.lineTo(p.x + bw / 2 - 1, sy);
          ctx.stroke();
        }
      }

      /* bay label */
      ctx.fillStyle = isDock ? "rgba(245,158,11,0.6)" : "rgba(148,163,184,0.5)";
      ctx.font = `bold ${Math.max(7, 8 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = isDock ? "top" : "middle";
      ctx.fillText(bay.id, p.x, isDock ? p.y + bh / 2 + 2 : p.y);
    }

    /* ── grid ───────────────────────────────────────────────── */
    for (let wx = Math.ceil(geo.min_x); wx <= geo.max_x; wx++) {
      const p = w2c({ x: wx, y: 0 });
      ctx.strokeStyle = wx % 5 === 0 ? C.gridMajor : C.gridLine;
      ctx.lineWidth = wx % 5 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, H);
      ctx.stroke();
    }
    for (let wy = Math.ceil(geo.min_y); wy <= geo.max_y; wy++) {
      const p = w2c({ x: 0, y: wy });
      ctx.strokeStyle = wy % 5 === 0 ? C.gridMajor : C.gridLine;
      ctx.lineWidth = wy % 5 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(W, p.y);
      ctx.stroke();
    }

    /* axis labels */
    ctx.fillStyle = C.textDim;
    ctx.font = `${Math.max(8, 9 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let wx = 0; wx <= geo.max_x; wx += 5) {
      const p = w2c({ x: wx, y: geo.min_y });
      ctx.fillText(`${wx}m`, p.x, Math.min(p.y + 4, H - 12));
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let wy = 0; wy <= geo.max_y; wy += 5) {
      const p = w2c({ x: geo.min_x, y: wy });
      ctx.fillText(`${wy}m`, Math.max(p.x - 4, 24), p.y);
    }

    /* ── shelf racks ────────────────────────────────────────── */
    const shelves = [
      { x1: 2, x2: 8, y: 11 },
      { x1: 12, x2: 17, y: 11 },
      { x1: 24, x2: 28, y: 11 },
      { x1: 3, x2: 7, y: 1 },
      { x1: 14, x2: 19, y: 1 },
      { x1: 24, x2: 29, y: 1 },
    ];
    for (const s of shelves) {
      const tl = w2c({ x: s.x1, y: s.y + 0.6 });
      const br = w2c({ x: s.x2, y: s.y });
      const sw = br.x - tl.x,
        sh = br.y - tl.y;
      ctx.fillStyle = C.shelf;
      ctx.strokeStyle = C.shelfTop;
      ctx.lineWidth = 1;
      ctx.fillRect(tl.x, tl.y, sw, sh);
      ctx.strokeRect(tl.x, tl.y, sw, sh);
      const segs = Math.floor((s.x2 - s.x1) / 1.5);
      for (let i = 1; i < segs; i++) {
        const sx = s.x1 + (i * (s.x2 - s.x1)) / segs;
        const sp = w2c({ x: sx, y: s.y });
        ctx.strokeStyle = "rgba(100,116,139,0.3)";
        ctx.beginPath();
        ctx.moveTo(sp.x, tl.y);
        ctx.lineTo(sp.x, tl.y + sh);
        ctx.stroke();
      }
    }

    /* ── geofence border ────────────────────────────────────── */
    const gf0 = w2c({ x: geo.min_x, y: geo.max_y });
    const gf1 = w2c({ x: geo.max_x, y: geo.min_y });
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(gf0.x, gf0.y, gf1.x - gf0.x, gf1.y - gf0.y);

    /* ── heatmap ────────────────────────────────────────────── */
    if (showHeatmap) {
      const g = 12;
      const bump = (d: number, r: number, w: number) => {
        const x = (r - d) / Math.max(w, 1e-6);
        return x <= 0 ? 0 : clamp(x, 0, 1);
      };
      for (let py = 0; py < H; py += g) {
        for (let px = 0; px < W; px += g) {
          const wp = c2w({ x: px + g / 2, y: py + g / 2 });
          let risk = 0;
          if (human && typeof human.x === "number")
            risk += 1.2 * bump(dist(wp, { x: +human.x, y: +human.y }), 2.5, 1.2);
          for (const ob of obstacles) {
            const d = dist(wp, { x: +ob.x, y: +ob.y }) - +(ob.r ?? ob.radius ?? 0.4);
            risk += 0.6 * bump(d, 1.1, 0.9);
          }
          const dEdge = Math.min(
            Math.abs(wp.x - geo.min_x),
            Math.abs(geo.max_x - wp.x),
            Math.abs(wp.y - geo.min_y),
            Math.abs(geo.max_y - wp.y),
          );
          risk += 0.35 * bump(dEdge, 0.6, 0.6);
          risk = clamp(risk, 0, 1);
          if (risk < 0.05) continue;
          ctx.fillStyle = `rgba(239,68,68,${0.04 + 0.3 * risk})`;
          ctx.fillRect(px, py, g, g);
        }
      }
    }

    /* ── trail ──────────────────────────────────────────────── */
    if (showTrail) {
      const tr = trailRef.current;
      if (tr.length >= 2) {
        for (let i = 1; i < tr.length; i++) {
          const a = 0.08 + (i / tr.length) * 0.4;
          const p0 = w2c(tr[i - 1]);
          const p1 = w2c(tr[i]);
          ctx.strokeStyle = `rgba(6,182,212,${a})`;
          ctx.lineWidth = 1.5 + (i / tr.length) * 1.5;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        for (let i = 0; i < tr.length; i += 8) {
          const p = w2c(tr[i]);
          ctx.fillStyle = `rgba(6,182,212,${0.15 + (i / tr.length) * 0.5})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* ── obstacles (crate boxes) ────────────────────────────── */
    for (const ob of obstacles) {
      const p = w2c({ x: +ob.x, y: +ob.y });
      const r = Math.max(5, +(ob.r ?? ob.radius ?? 0.5) * baseScale * zoom);

      /* glow */
      const grad = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 2.5);
      grad.addColorStop(0, "rgba(220,38,38,0.15)");
      grad.addColorStop(1, "rgba(220,38,38,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
      ctx.fill();

      /* box */
      const bs = r * 1.4;
      ctx.fillStyle = C.obstacle;
      ctx.strokeStyle = C.obsBorder;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x - bs, p.y - bs, bs * 2, bs * 2, 3);
      ctx.fill();
      ctx.stroke();

      /* cross */
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - bs + 2, p.y - bs + 2);
      ctx.lineTo(p.x + bs - 2, p.y + bs - 2);
      ctx.moveTo(p.x + bs - 2, p.y - bs + 2);
      ctx.lineTo(p.x - bs + 2, p.y + bs - 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `bold ${Math.max(7, 8 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("OBSTACLE", p.x, p.y - bs - 3);
    }

    /* ── human ──────────────────────────────────────────────── */
    if (human && typeof human.x === "number") {
      const p = w2c({ x: +human.x, y: +human.y });

      /* danger 1m */
      const dr = 1.0 * baseScale * zoom;
      ctx.fillStyle = C.humanDanger;
      ctx.strokeStyle = `rgba(239,68,68,${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, dr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      /* caution 3m */
      const cr = 3.0 * baseScale * zoom;
      ctx.fillStyle = C.humanCaution;
      ctx.strokeStyle = "rgba(245,158,11,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      /* ring labels */
      ctx.fillStyle = "rgba(239,68,68,0.6)";
      ctx.font = `${Math.max(7, 8 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText("STOP 1m", p.x, p.y - dr - 2);
      ctx.fillStyle = "rgba(245,158,11,0.5)";
      ctx.fillText("SLOW 3m", p.x, p.y - cr - 2);

      /* body */
      ctx.fillStyle = C.human;
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      /* head */
      ctx.beginPath();
      ctx.arc(p.x, p.y - 3 * zoom, 2.5 * zoom, 0, Math.PI * 2);
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      /* body line */
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 0.5 * zoom);
      ctx.lineTo(p.x, p.y + 3 * zoom);
      ctx.stroke();

      ctx.fillStyle = C.human;
      ctx.font = `bold ${Math.max(8, 9 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText("HUMAN", p.x, p.y + 12 * zoom);

      /* distance from robot */
      if (telemetry) {
        const d = dist(
          { x: +(telemetry.x ?? 0), y: +(telemetry.y ?? 0) },
          { x: +human.x, y: +human.y },
        );
        ctx.fillStyle = d < 1 ? "#ef4444" : d < 3 ? "#f59e0b" : "#22c55e";
        ctx.font = `bold ${Math.max(9, 10 * zoom)}px monospace`;
        ctx.fillText(`${d.toFixed(1)}m`, p.x, p.y + 22 * zoom);
      }
    }

    /* ── walking humans (secondary workers) ──────────────────── */
    for (const wh of walkingHumans) {
      if (typeof wh.x !== "number") continue;
      const p = w2c({ x: +wh.x, y: +wh.y });

      /* soft proximity glow */
      const gr = 1.5 * baseScale * zoom;
      ctx.fillStyle = "rgba(245,158,11,0.06)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
      ctx.fill();

      /* walking animation – small "legs" that alternate */
      const walkPhase = Math.sin(tick * 0.3 + (wh.x * 7 + wh.y * 13));
      const legSpread = wh.speed > 0 ? 3 * zoom * walkPhase : 0;

      /* body circle */
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      /* head */
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2.5 * zoom, 2 * zoom, 0, Math.PI * 2);
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 1;
      ctx.stroke();

      /* legs (animated) */
      ctx.strokeStyle = "#92400e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - legSpread, p.y + 3 * zoom);
      ctx.lineTo(p.x, p.y + 1 * zoom);
      ctx.lineTo(p.x + legSpread, p.y + 3 * zoom);
      ctx.stroke();

      /* direction indicator when moving */
      if (wh.speed > 0 && typeof wh.theta === "number") {
        const dLen = 8 * zoom;
        ctx.strokeStyle = "rgba(251,191,36,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(wh.theta) * dLen, p.y - Math.sin(wh.theta) * dLen);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* name label */
      const label = wh.label ?? "Worker";
      ctx.fillStyle = "rgba(251,191,36,0.8)";
      ctx.font = `${Math.max(7, 8 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(label, p.x, p.y + 9 * zoom);

      /* distance from robot */
      if (telemetry && typeof telemetry.x === "number") {
        const d = dist(
          { x: +(telemetry.x ?? 0), y: +(telemetry.y ?? 0) },
          { x: +wh.x, y: +wh.y },
        );
        if (d < 5) {
          ctx.fillStyle = d < 1 ? "#ef4444" : d < 3 ? "#f59e0b" : "#22c55e";
          ctx.font = `bold ${Math.max(7, 8 * zoom)}px monospace`;
          ctx.fillText(`${d.toFixed(1)}m`, p.x, p.y + 17 * zoom);
        }
      }
    }

    /* ── path preview ───────────────────────────────────────── */
    if (pathPoints && pathPoints.length >= 2) {
      ctx.strokeStyle = "rgba(59,130,246,0.15)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      const f = w2c(pathPoints[0]);
      ctx.moveTo(f.x, f.y);
      for (let i = 1; i < pathPoints.length; i++) {
        const pt = w2c(pathPoints[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

      ctx.strokeStyle = C.path;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      for (let i = 1; i < pathPoints.length; i++) {
        const pt = w2c(pathPoints[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ── LLM plan waypoints ─────────────────────────────────── */
    if (planWaypoints && planWaypoints.length > 0) {
      ctx.strokeStyle = C.plan;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      const sp = telemetry
        ? w2c({ x: +(telemetry.x ?? 0), y: +(telemetry.y ?? 0) })
        : w2c(planWaypoints[0]);
      ctx.moveTo(sp.x, sp.y);
      for (const wp of planWaypoints) {
        const p = w2c(wp);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      for (let i = 0; i < planWaypoints.length; i++) {
        const wp = planWaypoints[i];
        const p = w2c(wp);
        ctx.strokeStyle = C.plan;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = C.plan;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(9, 10 * zoom)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y);
        if (wp.max_speed != null) {
          ctx.fillStyle = C.textDim;
          ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
          ctx.textBaseline = "top";
          ctx.fillText(`${wp.max_speed.toFixed(1)}m/s`, p.x, p.y + 14);
        }
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    /* ── idle robots ──────────────────────────────────────────── */
    for (const ir of idleRobots) {
      if (typeof ir.x !== "number") continue;
      const p = w2c({ x: +ir.x, y: +ir.y });

      /* dim glow */
      const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
      rg.addColorStop(0, "rgba(100,116,139,0.15)");
      rg.addColorStop(1, "rgba(100,116,139,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();

      /* body (gray) */
      const rb = 8;
      ctx.fillStyle = "#475569";
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x - rb, p.y - rb, rb * 2, rb * 2, 3);
      ctx.fill();
      ctx.stroke();
      /* inner */
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.roundRect(p.x - 3, p.y - 3, 6, 6, 1.5);
      ctx.fill();
      /* center dot */
      ctx.fillStyle = "#94a3b8";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();

      /* heading arrow (dim) */
      const irt = +(ir.theta ?? 0);
      const al = 14;
      const ax = p.x + Math.cos(irt) * al;
      const ay = p.y - Math.sin(irt) * al;
      ctx.strokeStyle = "rgba(148,163,184,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      /* label */
      const lbl = ir.label ?? "Robot (Idle)";
      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${Math.max(7, 8 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(lbl, p.x, p.y - rb - 3);

      /* IDLE badge */
      const bw = 30;
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.roundRect(p.x - bw / 2, p.y + rb + 2, bw, 12, 2);
      ctx.fill();
      ctx.fillStyle = "#94a3b8";
      ctx.font = `bold ${Math.max(7, 8 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("IDLE", p.x, p.y + rb + 8);
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    /* ── robot ──────────────────────────────────────────────── */
    if (telemetry) {
      const rx = +(telemetry.x ?? 0);
      const ry = +(telemetry.y ?? 0);
      const rt = +(telemetry.theta ?? 0);
      const spd = +(telemetry.speed ?? 0);
      const p = w2c({ x: rx, y: ry });
      const st = String(safetyState).toUpperCase();

      /* safety ring */
      const sr = 22;
      if (st === "STOP") {
        ctx.strokeStyle = `rgba(239,68,68,${0.6 + pulse * 0.4})`;
        ctx.fillStyle = `rgba(239,68,68,${0.05 + pulse * 0.08})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (st === "SLOW") {
        ctx.strokeStyle = `rgba(245,158,11,${0.5 + pulse * 0.3})`;
        ctx.fillStyle = "rgba(245,158,11,0.06)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (st === "REPLAN") {
        ctx.strokeStyle = `rgba(99,102,241,${0.5 + pulse * 0.3})`;
        ctx.fillStyle = "rgba(99,102,241,0.06)";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* glow */
      const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 20);
      rg.addColorStop(0, C.robotGlow);
      rg.addColorStop(1, "rgba(6,182,212,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.fill();

      /* body */
      const rb = 10;
      ctx.fillStyle = C.robot;
      ctx.strokeStyle = C.robotDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x - rb, p.y - rb, rb * 2, rb * 2, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.robotDark;
      ctx.beginPath();
      ctx.roundRect(p.x - 4, p.y - 4, 8, 8, 2);
      ctx.fill();
      ctx.fillStyle = "#67e8f9";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();

      /* heading arrow */
      const al = 20;
      const ax = p.x + Math.cos(rt) * al;
      const ay = p.y - Math.sin(rt) * al;
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      const hl = 7;
      const ang = Math.atan2(-(ay - p.y), ax - p.x);
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - hl * Math.cos(ang - 0.45), ay + hl * Math.sin(ang - 0.45));
      ctx.lineTo(ax - hl * Math.cos(ang + 0.45), ay + hl * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();

      /* labels */
      ctx.fillStyle = "#22d3ee";
      ctx.font = `bold ${Math.max(9, 10 * zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("ROBOT", p.x, p.y - rb - 4);
      ctx.fillStyle = C.textDim;
      ctx.font = `${Math.max(8, 9 * zoom)}px monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(`${spd.toFixed(2)} m/s`, p.x, p.y + rb + 4);

      /* safety badge */
      if (st !== "OK" && st !== "SAFE") {
        const bc: Record<string, { bg: string; fg: string }> = {
          STOP: { bg: "#dc2626", fg: "#fff" },
          SLOW: { bg: "#d97706", fg: "#fff" },
          REPLAN: { bg: "#4f46e5", fg: "#fff" },
        };
        const c = bc[st] ?? { bg: "#475569", fg: "#fff" };
        const bw = st.length * 7 + 12;
        ctx.fillStyle = c.bg;
        ctx.beginPath();
        ctx.roundRect(p.x - bw / 2, p.y - rb - 22, bw, 14, 3);
        ctx.fill();
        ctx.fillStyle = c.fg;
        ctx.font = `bold ${Math.max(8, 9 * zoom)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(st, p.x, p.y - rb - 15);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";

      /* target cross-hair — from active sim target OR last plan waypoint */
      const tgt = telemetry.target
        || (planWaypoints && planWaypoints.length > 0 ? planWaypoints[planWaypoints.length - 1] : null);
      if (tgt && typeof tgt.x === "number") {
        const tp = w2c({ x: +tgt.x, y: +tgt.y });
        const cr = 10;

        /* pulsing outer ring */
        ctx.strokeStyle = `rgba(16,185,129,${0.4 + pulse * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, cr + 4 + pulse * 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = C.target;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, cr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tp.x - cr - 4, tp.y);
        ctx.lineTo(tp.x + cr + 4, tp.y);
        ctx.moveTo(tp.x, tp.y - cr - 4);
        ctx.lineTo(tp.x, tp.y + cr + 4);
        ctx.stroke();
        ctx.fillStyle = C.target;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.target;
        ctx.font = `bold ${Math.max(8, 9 * zoom)}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(telemetry.target ? "TARGET" : "DEST", tp.x, tp.y - cr - 5);
        ctx.textAlign = "start";
      }
    }

    /* ── HUD (top-left) ─────────────────────────────────────── */
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.beginPath();
    ctx.roundRect(6, 6, 96, 40, 4);
    ctx.fill();
    ctx.fillStyle = C.textDim;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("WAREHOUSE SIM", 12, 12);
    ctx.fillText(`${(geo.max_x - geo.min_x).toFixed(0)}×${(geo.max_y - geo.min_y).toFixed(0)}m`, 12, 24);
    ctx.fillText(`Zoom: ${zoom.toFixed(1)}×`, 12, 36);

    /* ── Legend (bottom-right) ──────────────────────────────── */
    const legend = [
      { color: C.robot, label: "Robot" },
      { color: "#475569", label: "Idle Robot" },
      { color: C.human, label: "Human" },
      { color: "#fbbf24", label: "Workers" },
      { color: C.obstacle, label: "Obstacle" },
      { color: "rgba(245,158,11,0.6)", label: "Bay/Dock" },
      { color: C.path, label: "Path" },
      { color: C.plan, label: "LLM Plan" },
      { color: C.target, label: "Target" },
    ];
    const lx = W - 80,
      ly = H - 10 - legend.length * 14;
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.beginPath();
    ctx.roundRect(lx - 6, ly - 6, 84, legend.length * 14 + 10, 4);
    ctx.fill();
    legend.forEach((it, i) => {
      const y = ly + i * 14;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      ctx.roundRect(lx, y, 8, 8, 2);
      ctx.fill();
      ctx.fillStyle = C.text;
      ctx.font = "9px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(it.label, lx + 12, y);
    });
  }, [world, telemetry, pathPoints, planWaypoints, baseScale, zoom, pan, showHeatmap, showTrail, safetyState, tick, pad, zones, obstacles, human, walkingHumans, idleRobots, bays, geo]);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      style={{ width: "100%", borderRadius: 12, touchAction: "none", background: C.floor }}
      className="border border-slate-700"
    />
  );
}