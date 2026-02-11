"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type World = any;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

type Pt = { x: number; y: number };

function dist(a: Pt, b: Pt) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 2D operator map for a simulated robotics environment.
 *
 * Upgrades:
 * - Zoom + pan (mouse wheel / trackpad; drag to pan)
 * - Risk heatmap (lightweight distance-based field)
 * - Trailing path history (robot breadcrumb trail)
 * - Safety indicators (STOP / SLOW / REPLAN overlay)
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
  pathPoints: Array<{ x: number; y: number }> | null;
  planWaypoints?: Array<{ x: number; y: number; max_speed?: number }> | null;
  showHeatmap?: boolean;
  showTrail?: boolean;
  safetyState?: "OK" | "STOP" | "SLOW" | "REPLAN" | string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const width = 520;
  const height = 320;

  const geo = world?.geofence || { min_x: 0, max_x: 30, min_y: 0, max_y: 20 };
  const obstacles = world?.obstacles || [];
  const human = world?.human || null;

  const baseScale = useMemo(() => {
    const wx = (geo.max_x - geo.min_x) || 1;
    const wy = (geo.max_y - geo.min_y) || 1;
    return Math.min(width / wx, height / wy);
  }, [geo, width, height]);

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const dragging = useRef(false);
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  const trailRef = useRef<Pt[]>([]);

  function worldToCanvas(p: Pt) {
    const sx = (p.x - geo.min_x) * baseScale;
    const sy = height - (p.y - geo.min_y) * baseScale;
    const z = zoom;
    return { x: sx * z + pan.x, y: sy * z + pan.y };
  }

  function canvasToWorld(px: Pt) {
    const z = zoom;
    const sx = (px.x - pan.x) / Math.max(z, 1e-6);
    const sy = (px.y - pan.y) / Math.max(z, 1e-6);
    const wx = sx / baseScale + geo.min_x;
    const wy = ((height - sy) / baseScale) + geo.min_y;
    return { x: wx, y: wy };
  }

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;

      const before = canvasToWorld({ x: cx, y: cy });
      const nextZoom = clamp(zoom * factor, 0.6, 6);

      setZoom(nextZoom);

      const sx = (before.x - geo.min_x) * baseScale;
      const sy = height - (before.y - geo.min_y) * baseScale;
      setPan({ x: cx - sx * nextZoom, y: cy - sy * nextZoom });
    }

    function onPointerDown(e: PointerEvent) {
      dragging.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!dragging.current || !lastMouse.current) return;
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }

    function onPointerUp(e: PointerEvent) {
      dragging.current = false;
      lastMouse.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("wheel", onWheel as any);
      canvas.removeEventListener("pointerdown", onPointerDown as any);
      canvas.removeEventListener("pointermove", onPointerMove as any);
      canvas.removeEventListener("pointerup", onPointerUp as any);
      canvas.removeEventListener("pointercancel", onPointerUp as any);
    };
  }, [zoom, baseScale, geo.min_x, geo.min_y]);

  useEffect(() => {
    if (!telemetry) return;
    const rx = Number(telemetry.x ?? 0);
    const ry = Number(telemetry.y ?? 0);
    const next = { x: rx, y: ry };

    const trail = trailRef.current;
    const last = trail.length ? trail[trail.length - 1] : null;
    if (!last || dist(last, next) > 0.03) {
      trail.push(next);
      if (trail.length > 240) trail.splice(0, trail.length - 240);
    }
  }, [telemetry]);

  function drawHeatmap(ctx: CanvasRenderingContext2D) {
    const grid = 18;
    const maxX = width;
    const maxY = height;

    const bump = (d: number, r: number, w: number) => {
      const x = (r - d) / Math.max(w, 1e-6);
      if (x <= 0) return 0;
      return clamp(x, 0, 1);
    };

    for (let y = 0; y < maxY; y += grid) {
      for (let x = 0; x < maxX; x += grid) {
        const wpt = canvasToWorld({ x: x + grid / 2, y: y + grid / 2 });

        let risk = 0;

        if (human && typeof human.x === "number" && typeof human.y === "number") {
          const d = dist(wpt, { x: Number(human.x), y: Number(human.y) });
          risk += 1.2 * bump(d, 2.0, 1.0);
        }

        for (const ob of obstacles) {
          const ox = Number(ob.x ?? 0);
          const oy = Number(ob.y ?? 0);
          const r = Number(ob.r ?? ob.radius ?? 0.4);
          const d = dist(wpt, { x: ox, y: oy }) - r;
          risk += 0.6 * bump(d, 1.1, 0.9);
        }

        const dEdge = Math.min(
          Math.abs(wpt.x - geo.min_x),
          Math.abs(geo.max_x - wpt.x),
          Math.abs(wpt.y - geo.min_y),
          Math.abs(geo.max_y - wpt.y)
        );
        risk += 0.45 * bump(dEdge, 0.6, 0.6);

        risk = clamp(risk, 0, 1);
        if (risk < 0.05) continue;

        ctx.fillStyle = `rgba(239, 68, 68, ${0.08 + 0.35 * risk})`;
        ctx.fillRect(x, y, grid, grid);
      }
    }
  }

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    if (showHeatmap) drawHeatmap(ctx);

    const gf0 = worldToCanvas({ x: geo.min_x, y: geo.min_y });
    const gf1 = worldToCanvas({ x: geo.max_x, y: geo.max_y });
    const left = Math.min(gf0.x, gf1.x);
    const right = Math.max(gf0.x, gf1.x);
    const top = Math.min(gf0.y, gf1.y);
    const bottom = Math.max(gf0.y, gf1.y);

    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, right - left, bottom - top);

    if (showTrail) {
      const trail = trailRef.current;
      if (trail.length >= 2) {
        ctx.strokeStyle = "rgba(17, 24, 39, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const first = worldToCanvas(trail[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < trail.length; i++) {
          const p = worldToCanvas(trail[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#ef4444";
    for (const ob of obstacles) {
      const ox = Number(ob.x ?? 0);
      const oy = Number(ob.y ?? 0);
      const r = Number(ob.r ?? ob.radius ?? 0.4);
      const p = worldToCanvas({ x: ox, y: oy });
      const rr = Math.max(3, r * baseScale * zoom);
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (human) {
      const p = worldToCanvas({ x: Number(human.x), y: Number(human.y) });
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * baseScale * zoom, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pathPoints && pathPoints.length >= 2) {
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const first = worldToCanvas(pathPoints[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pathPoints.length; i++) {
        const pt = worldToCanvas(pathPoints[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    // Plan waypoints (numbered, from LLM)
    if (planWaypoints && planWaypoints.length > 0) {
      // Draw connecting line
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      const startPt = telemetry
        ? worldToCanvas({ x: Number(telemetry.x ?? 0), y: Number(telemetry.y ?? 0) })
        : worldToCanvas(planWaypoints[0]);
      ctx.moveTo(startPt.x, startPt.y);
      for (const wp of planWaypoints) {
        const p = worldToCanvas(wp);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw waypoint markers
      for (let i = 0; i < planWaypoints.length; i++) {
        const wp = planWaypoints[i];
        const p = worldToCanvas(wp);
        // Circle
        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        // Number
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y);
      }
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    if (telemetry) {
      const rx = Number(telemetry.x ?? 0);
      const ry = Number(telemetry.y ?? 0);
      const rt = Number(telemetry.theta ?? 0);
      const p = worldToCanvas({ x: rx, y: ry });

      const st = String(safetyState).toUpperCase();
      if (st === "STOP") {
        ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      } else if (st === "SLOW") {
        ctx.strokeStyle = "rgba(245, 158, 11, 0.8)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      } else if (st === "REPLAN") {
        ctx.strokeStyle = "rgba(99, 102, 241, 0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(rt) * 14, p.y - Math.sin(rt) * 14);
      ctx.stroke();

      const tgt = telemetry.target;
      if (tgt && typeof tgt.x === "number" && typeof tgt.y === "number") {
        const tp = worldToCanvas({ x: Number(tgt.x), y: Number(tgt.y) });
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = "#374151";
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("Wheel: zoom • Drag: pan", 10, height - 10);
  }, [world, telemetry, pathPoints, planWaypoints, baseScale, zoom, pan, showHeatmap, showTrail, safetyState]);

  return (
    <div>
      <canvas
        ref={ref}
        width={width}
        height={height}
        style={{ width: "100%", border: "1px solid #eee", borderRadius: 12, touchAction: "none" }}
      />
      <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
        Blue: path preview • Red: obstacles • Orange: human clearance • Green: target • Purple: LLM plan • Black: robot pose • Trail: breadcrumbs
      </div>
    </div>
  );
}
