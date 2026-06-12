"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BASEMAP } from "@/lib/basemap";

export type Tier = "testbed" | "extension";
export type Kind = "endpoint" | "repeater";

export interface NetworkNode {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: Kind;
  tier: Tier;
  /** dx/dy (SVG units) from the node to its label center; fans dense clusters. */
  labelOffset?: { dx: number; dy: number };
}

export interface NetworkLink {
  from: string; // node id
  to: string; // node id
  fidelity: number; // 0..1, current value (from /api/state)
  available_count?: number; // live pairs on this link (drives beam intensity)
}

/** A transient, data-driven animation directive (one lifecycle moment). */
export type MapAnim =
  | { id: string; kind: "birth" | "expire" | "failure"; from: string; to: string }
  | { id: string; kind: "swap"; at: string };

interface QuantumCorridorMapProps {
  nodes: NetworkNode[];
  links: NetworkLink[];
  activePath?: string[]; // ordered node ids of a fulfilled route to highlight
  deliveredFidelity?: number; // the route's true end-to-end fidelity (from the request)
  animations?: MapAnim[]; // transient lifecycle animations to play
  labelMode?: "endpoints" | "all" | "hover";
  reducedMotion?: boolean;
  className?: string;
}

// Geographic bounds of the US East Coast corridor.
const BOUNDS = { minLat: 38.2, maxLat: 42.8, minLng: -77.8, maxLng: -70.4 };
const VIEW = { w: 800, h: 680, pad: 64 };
const CENTER_LAT = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
const LNG_SCALE = Math.cos((CENTER_LAT * Math.PI) / 180); // de-stretch longitude

const COLOR = { endpoint: "#4F46E5", repeater: "#0EA5E9", route: "#4F46E5", danger: "#EF4444", swap: "#7C3AED" };

function fidelityColor(f: number) {
  const v = Math.max(0, Math.min(1, f));
  const stops = [
    { t: 0.0, c: [239, 68, 68] }, // #EF4444 red (low)
    { t: 0.5, c: [245, 158, 11] }, // #F59E0B amber (mid)
    { t: 1.0, c: [16, 185, 129] }, // #10B981 emerald (high)
  ];
  let a = stops[0],
    b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i].t && v <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const k = (v - a.t) / (b.t - a.t || 1);
  const ch = (i: number) => Math.round(a.c[i] + (b.c[i] - a.c[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

const edgeKey = (a: string, b: string) => [a, b].sort().join("|");

// ---------------------------------------------------------------------------
// Label / chip geometry (deterministic, no randomness)
// ---------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number } // top-left anchored
interface Pt { x: number; y: number }

/** Approximate rendered chip width/height for a label string. */
function labelSize(text: string): { w: number; h: number } {
  return { w: Math.max(28, text.length * 6.2 + 14), h: 20 };
}
function chipSize(text: string, isDst: boolean): { w: number; h: number } {
  return isDst
    ? { w: text.length * 6.6 + 18, h: 22 }
    : { w: text.length * 6.0 + 12, h: 17 };
}
function rectFromCenter(cx: number, cy: number, w: number, h: number): Rect {
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
function rectsOverlap(a: Rect, b: Rect, pad = 2): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
/** Keep a chip/label fully inside the viewBox (small margin). */
function clampCenter(cx: number, cy: number, w: number, h: number): Pt {
  return {
    x: Math.min(VIEW.w - 4 - w / 2, Math.max(4 + w / 2, cx)),
    y: Math.min(VIEW.h - 4 - h / 2, Math.max(4 + h / 2, cy)),
  };
}

// The dense Long Island / NYC testbed cluster whose labels must be deconflicted.
const CLUSTER = new Set(["bnl", "sbu", "commack", "westbury", "nyc", "columbia", "yale"]);

interface LabelBox { cx: number; cy: number; w: number; h: number }

/**
 * Deterministic label declutter: seed each label (manual nudge, else radially
 * away from the cluster centroid, else above the node), then iteratively push
 * overlapping label rects apart and off foreign node markers, capping how far a
 * label can drift and clamping to the viewBox. Produces real non-overlapping
 * positions at the current projection rather than relying on hand-guessed dx/dy.
 */
function computeLabelLayout(
  shown: Array<{ id: string; label: string; p: Pt; seed?: { dx: number; dy: number } }>,
  markers: Array<{ id: string; p: Pt }>,
): Map<string, LabelBox> {
  const cl = shown.filter((s) => CLUSTER.has(s.id));
  const cx0 = cl.reduce((a, s) => a + s.p.x, 0) / (cl.length || 1);
  const cy0 = cl.reduce((a, s) => a + s.p.y, 0) / (cl.length || 1);

  const items = shown.map((s) => {
    const size = labelSize(s.label);
    let c: Pt;
    if (s.seed) {
      c = { x: s.p.x + s.seed.dx, y: s.p.y + s.seed.dy };
    } else if (CLUSTER.has(s.id)) {
      const vx = s.p.x - cx0;
      const vy = s.p.y - cy0;
      const m = Math.hypot(vx, vy) || 1;
      c = { x: s.p.x + (vx / m) * 30, y: s.p.y + (vy / m) * 30 };
    } else {
      c = { x: s.p.x, y: s.p.y - 20 };
    }
    return { id: s.id, node: s.p, size, c };
  });

  const MAXDISP = 64;
  for (let iter = 0; iter < 80; iter++) {
    // pairwise separation
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const ri = rectFromCenter(items[i].c.x, items[i].c.y, items[i].size.w, items[i].size.h);
        const rj = rectFromCenter(items[j].c.x, items[j].c.y, items[j].size.w, items[j].size.h);
        if (!rectsOverlap(ri, rj, 3)) continue;
        let dx = items[i].c.x - items[j].c.x;
        let dy = items[i].c.y - items[j].c.y;
        if (dx === 0 && dy === 0) {
          dx = i < j ? 1 : -1;
          dy = 0.5;
        }
        const m = Math.hypot(dx, dy) || 1;
        items[i].c.x += (dx / m) * 2;
        items[i].c.y += (dy / m) * 2;
        items[j].c.x -= (dx / m) * 2;
        items[j].c.y -= (dy / m) * 2;
      }
    }
    // push labels off foreign node markers, cap drift, clamp
    for (const it of items) {
      const r = rectFromCenter(it.c.x, it.c.y, it.size.w, it.size.h);
      for (const mk of markers) {
        if (mk.p.x === it.node.x && mk.p.y === it.node.y) continue;
        const mr: Rect = { x: mk.p.x - 7, y: mk.p.y - 7, w: 14, h: 14 };
        if (!rectsOverlap(r, mr, 1)) continue;
        let dx = it.c.x - mk.p.x;
        let dy = it.c.y - mk.p.y;
        if (dx === 0 && dy === 0) {
          dx = 1;
          dy = -1;
        }
        const mm = Math.hypot(dx, dy) || 1;
        it.c.x += (dx / mm) * 2;
        it.c.y += (dy / mm) * 2;
      }
      const vx = it.c.x - it.node.x;
      const vy = it.c.y - it.node.y;
      const dd = Math.hypot(vx, vy);
      if (dd > MAXDISP) {
        it.c.x = it.node.x + (vx / dd) * MAXDISP;
        it.c.y = it.node.y + (vy / dd) * MAXDISP;
      }
      const cc = clampCenter(it.c.x, it.c.y, it.size.w, it.size.h);
      it.c.x = cc.x;
      it.c.y = cc.y;
    }
  }
  return new Map(items.map((it) => [it.id, { cx: it.c.x, cy: it.c.y, w: it.size.w, h: it.size.h }]));
}

/** First non-overlapping slot around an anchor, or null if all collide. */
function placeChip(anchor: Pt, size: { w: number; h: number }, occupied: Rect[]): Rect | null {
  const s = size;
  const slots: Pt[] = [
    { x: 0, y: -(s.h / 2 + 10) }, // above
    { x: 0, y: s.h / 2 + 10 }, //    below
    { x: s.w / 2 + 12, y: 0 }, //    right
    { x: -(s.w / 2 + 12), y: 0 }, // left
    { x: s.w / 2 + 10, y: -(s.h / 2 + 8) }, // up-right
    { x: -(s.w / 2 + 10), y: -(s.h / 2 + 8) }, // up-left
    { x: s.w / 2 + 10, y: s.h / 2 + 8 }, //      down-right
    { x: -(s.w / 2 + 10), y: s.h / 2 + 8 }, //   down-left
  ];
  for (const slot of slots) {
    const c = clampCenter(anchor.x + slot.x, anchor.y + slot.y, s.w, s.h);
    const r = rectFromCenter(c.x, c.y, s.w, s.h);
    if (!occupied.some((o) => rectsOverlap(r, o, 2))) return r;
  }
  return null;
}
/**
 * Destination-chip placement: try slots at growing radius until one is clear, so
 * the centerpiece chip escapes even a dense cluster without overlapping a label.
 * Falls back to least-overlap only if nothing is ever free.
 */
function placeChipEscalating(anchor: Pt, size: { w: number; h: number }, occupied: Rect[]): Rect {
  for (const f of [1, 1.6, 2.3, 3.2]) {
    const ox = (size.w / 2 + 12) * f;
    const oy = (size.h / 2 + 10) * f;
    const slots: Pt[] = [
      { x: 0, y: oy }, //   below (toward open water for the LI cluster)
      { x: 0, y: -oy }, //  above
      { x: ox, y: 0 }, //   right
      { x: -ox, y: 0 }, //  left
      { x: ox * 0.8, y: oy * 0.8 },
      { x: -ox * 0.8, y: oy * 0.8 },
      { x: ox * 0.8, y: -oy * 0.8 },
      { x: -ox * 0.8, y: -oy * 0.8 },
    ];
    for (const slot of slots) {
      const c = clampCenter(anchor.x + slot.x, anchor.y + slot.y, size.w, size.h);
      const r = rectFromCenter(c.x, c.y, size.w, size.h);
      if (!occupied.some((o) => rectsOverlap(r, o, 2))) return r;
    }
  }
  return placeChipForced(anchor, size, occupied);
}

/** Least-overlap slot — final fallback if no clear slot exists anywhere. */
function placeChipForced(anchor: Pt, size: { w: number; h: number }, occupied: Rect[]): Rect {
  const s = size;
  const slots: Pt[] = [
    { x: 0, y: -(s.h / 2 + 10) },
    { x: s.w / 2 + 12, y: 0 },
    { x: 0, y: s.h / 2 + 10 },
    { x: -(s.w / 2 + 12), y: 0 },
  ];
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (const slot of slots) {
    const c = clampCenter(anchor.x + slot.x, anchor.y + slot.y, s.w, s.h);
    const r = rectFromCenter(c.x, c.y, s.w, s.h);
    const area = occupied.reduce((a, o) => a + overlapArea(r, o), 0);
    if (area < bestArea) {
      bestArea = area;
      best = r;
    }
  }
  return best!;
}

export function QuantumCorridorMap({
  nodes,
  links,
  activePath = [],
  deliveredFidelity,
  animations = [],
  labelMode = "endpoints",
  reducedMotion = false,
  className = "",
}: QuantumCorridorMapProps) {
  const uid = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<string | null>(null);

  // Uniform, shape-preserving projection that centers the corridor in the box.
  const project = useMemo(() => {
    const innerW = VIEW.w - 2 * VIEW.pad;
    const innerH = VIEW.h - 2 * VIEW.pad;
    const lngSpan = (BOUNDS.maxLng - BOUNDS.minLng) * LNG_SCALE;
    const latSpan = BOUNDS.maxLat - BOUNDS.minLat;
    const scale = Math.min(innerW / lngSpan, innerH / latSpan);
    const offX = VIEW.pad + (innerW - lngSpan * scale) / 2;
    const offY = VIEW.pad + (innerH - latSpan * scale) / 2;
    return (lat: number, lng: number) => ({
      x: offX + (lng - BOUNDS.minLng) * LNG_SCALE * scale,
      y: offY + (BOUNDS.maxLat - lat) * scale,
    });
  }, []);

  const nodeById = useMemo(() => {
    const m = new Map<string, NetworkNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const projected = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    nodes.forEach((n) => m.set(n.id, project(n.lat, n.lng)));
    return m;
  }, [nodes, project]);

  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const midX = (a.x + b.x) / 2;
    const lift = Math.hypot(b.x - a.x, b.y - a.y) * 0.18;
    const midY = Math.min(a.y, b.y) - lift;
    return { d: `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`, ctrl: { x: midX, y: midY } };
  };

  // Quadratic Bézier midpoint (t=0.5) — used to anchor link animations.
  const curveMid = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const { ctrl } = curve(a, b);
    return { x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y };
  };

  // Live pair count + fidelity per edge, for tooltips and route chips.
  const linkByEdge = useMemo(() => {
    const m = new Map<string, NetworkLink>();
    links.forEach((l) => m.set(edgeKey(l.from, l.to), l));
    return m;
  }, [links]);

  const pairCountByNode = useMemo(() => {
    const m = new Map<string, number>();
    links.forEach((l) => {
      const c = l.available_count ?? 0;
      m.set(l.from, (m.get(l.from) ?? 0) + c);
      m.set(l.to, (m.get(l.to) ?? 0) + c);
    });
    return m;
  }, [links]);

  const activeEdges = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i < activePath.length - 1; i++) s.add(edgeKey(activePath[i], activePath[i + 1]));
    return s;
  }, [activePath]);

  // ----- Cinematic route fulfillment sequence (the centerpiece) -------------
  const [route, setRoute] = useState<{
    path: string[];
    hopFids: number[];
    delivered: number;
    key: number;
  } | null>(null);
  const prevPathKey = useRef("");
  const routeSeq = useRef(0);

  useEffect(() => {
    const key = activePath.join(">");
    if (key === prevPathKey.current) return;
    prevPathKey.current = key;
    if (activePath.length < 2) {
      setRoute(null);
      return;
    }
    const hopFids: number[] = [];
    for (let i = 0; i < activePath.length - 1; i++) {
      const l = linkByEdge.get(edgeKey(activePath[i], activePath[i + 1]));
      // Links just consumed by the swap can momentarily read 0; treat as unknown.
      hopFids.push(l && l.fidelity > 0.01 ? l.fidelity : NaN);
    }
    // Prefer the request's true delivered fidelity; fall back to the product.
    const product = hopFids.reduce((a, f) => a * (Number.isNaN(f) ? 1 : f), 1);
    const delivered = deliveredFidelity != null && deliveredFidelity > 0 ? deliveredFidelity : product;
    const seq = ++routeSeq.current;
    setRoute({ path: [...activePath], hopFids, delivered, key: seq });
    const hold = reducedMotion ? 2600 : activePath.length * 350 + 2600;
    const t = setTimeout(() => {
      if (routeSeq.current === seq) setRoute(null);
    }, hold);
    return () => clearTimeout(t);
  }, [activePath, linkByEdge, reducedMotion, deliveredFidelity]);

  const routeActive = !!route;
  const baseOpacity = routeActive ? 0.22 : 1;

  const showLabel = (n: NetworkNode) =>
    labelMode === "all" ||
    (labelMode === "endpoints" && n.kind === "endpoint") ||
    hovered === n.id;

  // Deterministic, non-overlapping positions for the always-on (endpoint)
  // labels — derived from the real projection, not hand-guessed offsets.
  const labelLayout = useMemo(() => {
    const shown = nodes
      .filter((n) => n.kind === "endpoint" && projected.get(n.id))
      .map((n) => ({ id: n.id, label: n.label, p: projected.get(n.id)!, seed: n.labelOffset }));
    const markers = nodes
      .filter((n) => projected.get(n.id))
      .map((n) => ({ id: n.id, p: projected.get(n.id)! }));
    return computeLabelLayout(shown, markers);
  }, [nodes, projected]);

  const labelBoxFor = (n: NetworkNode, p: Pt): LabelBox => {
    const found = labelLayout.get(n.id);
    if (found) return found;
    const size = labelSize(n.label);
    return { cx: p.x, cy: p.y - 20, w: size.w, h: size.h };
  };

  // Collision-aware route fidelity-chip placement (destination first, then
  // intermediates; intermediates drop rather than overlap a label or chip).
  const routeChips = useMemo(() => {
    if (!route) return null;
    const lastIdx = route.path.length - 1;
    const dstId = route.path[lastIdx];
    // The destination's own label is hidden during the route, so the chip may use
    // its space; every OTHER label is an obstacle.
    const occupied: Rect[] = [];
    labelLayout.forEach((L, id) => {
      if (id !== dstId) occupied.push(rectFromCenter(L.cx, L.cy, L.w, L.h));
    });
    const placements = new Map<number, { rect: Rect; text: string; isDst: boolean }>();
    const pDst = projected.get(dstId);
    if (pDst) {
      const text = `delivered F=${route.delivered.toFixed(2)}`;
      const size = chipSize(text, true);
      const rect = placeChipEscalating(pDst, size, occupied);
      placements.set(lastIdx, { rect, text, isDst: true });
      occupied.push(rect);
    }
    for (let i = 1; i < lastIdx; i++) {
      const f = route.hopFids[i - 1];
      if (Number.isNaN(f)) continue;
      const p = projected.get(route.path[i]);
      if (!p) continue;
      const text = `×${f.toFixed(2)}`;
      const size = chipSize(text, false);
      const rect = placeChip(p, size, occupied);
      if (!rect) continue;
      placements.set(i, { rect, text, isDst: false });
      occupied.push(rect);
    }
    return placements;
  }, [route, labelLayout, projected]);

  // Real Northeast US state outlines, projected with the same fn as the nodes.
  const landPaths = useMemo(() => {
    return BASEMAP.flatMap((s) =>
      s.rings.map((ring) => {
        let d = "";
        for (let i = 0; i < ring.length; i++) {
          const p = project(ring[i][1], ring[i][0]);
          d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
        }
        return d + "Z";
      }),
    );
  }, [project]);

  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full select-none">
        <defs>
          <filter id={`glow-${uid}`}>
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* water + real Northeast US landmasses */}
        <rect x={0} y={0} width={VIEW.w} height={VIEW.h} fill="#F1F6FB" />
        <g>
          {landPaths.map((d, i) => (
            <path key={i} d={d} fill="#E7EDF4" stroke="#CBD5E1" strokeWidth={0.75} strokeLinejoin="round" />
          ))}
        </g>

        {/* ---- base layer: arcs (dimmed while a route plays) ---- */}
        <g style={{ opacity: baseOpacity }} className="transition-opacity duration-300">
          {links.map((link, i) => {
            const a = projected.get(link.from);
            const b = projected.get(link.to);
            if (!a || !b) return null;
            const color = fidelityColor(link.fidelity);
            const isActive = activeEdges.has(edgeKey(link.from, link.to));
            const opacity = 0.18 + 0.72 * Math.max(0, Math.min(1, link.fidelity));
            const { d } = curve(a, b);
            const count = link.available_count ?? 0;
            const showBeam = !reducedMotion && (count > 0 || link.fidelity > 0.7);
            const beamDur = count > 0 ? Math.max(1.4, 3.2 - Math.min(2, count / 6)) : 2.8;
            return (
              <g key={`link-${i}`}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 3 : 1.6}
                  strokeLinecap="round"
                  style={{ opacity }}
                  initial={reducedMotion ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={reducedMotion ? { duration: 0 } : { duration: 1.1, ease: "easeInOut" }}
                />
                {showBeam && (
                  <motion.circle
                    r={2.6}
                    fill={color}
                    initial={{ offsetDistance: "0%", opacity: 0 }}
                    animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 0] }}
                    transition={{ duration: beamDur, repeat: Infinity, ease: "easeInOut" }}
                    style={{ offsetPath: `path('${d}')` } as unknown as CSSProperties}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* ---- transient lifecycle animations (birth / swap / expire / failure) ---- */}
        {!reducedMotion && (
          <g>
            <AnimatePresence>
              {animations.map((anim) => {
                if (anim.kind === "swap") {
                  const p = projected.get(anim.at);
                  if (!p) return null;
                  return (
                    <motion.circle
                      key={anim.id}
                      cx={p.x}
                      cy={p.y}
                      fill="none"
                      stroke={COLOR.swap}
                      strokeWidth={2}
                      initial={{ r: 4, opacity: 0.9 }}
                      animate={{ r: 22, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                    />
                  );
                }
                const a = projected.get(anim.from);
                const b = projected.get(anim.to);
                if (!a || !b) return null;
                const m = curveMid(a, b);
                if (anim.kind === "birth") {
                  return (
                    <motion.circle
                      key={anim.id}
                      cx={m.x}
                      cy={m.y}
                      fill="#10B981"
                      initial={{ r: 1, opacity: 0.0 }}
                      animate={{ r: [1, 9, 5], opacity: [0, 0.85, 0] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  );
                }
                // expire / failure: red burst
                const danger = anim.kind === "failure";
                return (
                  <motion.circle
                    key={anim.id}
                    cx={m.x}
                    cy={m.y}
                    fill="none"
                    stroke={COLOR.danger}
                    strokeWidth={danger ? 3 : 1.6}
                    strokeDasharray={danger ? "4 3" : undefined}
                    initial={{ r: 2, opacity: 0.9 }}
                    animate={{ r: danger ? 26 : 14, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: danger ? 0.7 : 0.55, ease: "easeOut" }}
                  />
                );
              })}
            </AnimatePresence>
          </g>
        )}

        {/* ---- nodes (dimmed while a route plays) ---- */}
        <g style={{ opacity: baseOpacity }} className="transition-opacity duration-300">
          {nodes.map((n, i) => {
            const p = projected.get(n.id);
            if (!p) return null;
            const isTestbed = n.tier === "testbed";
            const fill = n.kind === "endpoint" ? COLOR.endpoint : COLOR.repeater;
            return (
              <g
                key={`node-${n.id}`}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}
              >
                {!reducedMotion && isTestbed && (
                  <circle cx={p.x} cy={p.y} r={4} fill={fill} opacity={0.5}>
                    <animate attributeName="r" from="4" to="16" dur="2.4s" begin={`${(i % 5) * 0.3}s`} repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.5" to="0" dur="2.4s" begin={`${(i % 5) * 0.3}s`} repeatCount="indefinite" />
                  </circle>
                )}
                {/* testbed-tier distinguishing ring */}
                {isTestbed && <circle cx={p.x} cy={p.y} r={8} fill="none" stroke={COLOR.route} strokeWidth={1.5} opacity={0.55} />}
                <circle cx={p.x} cy={p.y} r={n.kind === "endpoint" ? 4.5 : 3.4} fill={fill} filter={`url(#glow-${uid})`} />
                {/* invisible larger hit target for hover */}
                <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
              </g>
            );
          })}
        </g>

        {/* ---- label layer (above arcs + nodes), with leader lines ---- */}
        <g>
          {nodes.map((n) => {
            const p = projected.get(n.id);
            if (!p || !showLabel(n)) return null;
            // The destination's own label is replaced by its "delivered F" chip.
            if (routeActive && activePath[activePath.length - 1] === n.id) return null;
            const box = labelBoxFor(n, p);
            const dist = Math.hypot(box.cx - p.x, box.cy - p.y);
            // During a route hold, dim non-path labels harder so chips read clearly.
            const onPath = activePath.includes(n.id);
            const dim = routeActive ? (onPath ? 0.5 : 0.2) : 1;
            return (
              <g key={`label-${n.id}`} className="pointer-events-none" style={{ opacity: dim }}>
                {dist > 14 && (
                  <line x1={p.x} y1={p.y} x2={box.cx} y2={box.cy} stroke="#9CA3AF" strokeWidth={0.75} opacity={0.6} />
                )}
                <foreignObject x={box.cx - box.w / 2} y={box.cy - box.h / 2} width={box.w} height={box.h}>
                  <div className="flex h-full items-center justify-center">
                    <span className="whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-[#111827] shadow-sm">
                      {n.label}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </g>

        {/* ---- route fulfillment overlay (cinematic) ---- */}
        {route && (
          <g key={`route-${route.key}`}>
            {route.path.slice(0, -1).map((from, i) => {
              const a = projected.get(from);
              const b = projected.get(route.path[i + 1]);
              if (!a || !b) return null;
              const { d } = curve(a, b);
              const delay = reducedMotion ? 0 : i * 0.35;
              return (
                <motion.path
                  key={`rh-${i}`}
                  d={d}
                  fill="none"
                  stroke={COLOR.route}
                  strokeWidth={4}
                  strokeLinecap="round"
                  filter={`url(#glow-${uid})`}
                  initial={reducedMotion ? { pathLength: 1 } : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reducedMotion ? 0 : 0.34, delay, ease: "easeInOut" }}
                />
              );
            })}
            {/* per-hop node pulses + fidelity chips */}
            {route.path.map((id, i) => {
              const p = projected.get(id);
              if (!p) return null;
              const isDst = i === route.path.length - 1;
              const delay = reducedMotion ? 0 : i * 0.35;
              return (
                <g key={`rn-${id}`}>
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    fill="none"
                    stroke={COLOR.route}
                    strokeWidth={2}
                    initial={reducedMotion ? { r: 9, opacity: 0 } : { r: 4, opacity: 0.9 }}
                    animate={{ r: isDst ? 16 : 11, opacity: 0 }}
                    transition={{ duration: 0.7, delay, ease: "easeOut" }}
                  />
                  <circle cx={p.x} cy={p.y} r={isDst ? 5.5 : 4.5} fill={COLOR.route} />
                </g>
              );
            })}
            {/* collision-aware fidelity chips (precomputed, no overlap) */}
            {routeChips &&
              [...routeChips.entries()].map(([i, chip]) => {
                const p = projected.get(route.path[i]);
                if (!p) return null;
                const delay = reducedMotion ? 0 : i * 0.35;
                const ccx = chip.rect.x + chip.rect.w / 2;
                const ccy = chip.rect.y + chip.rect.h / 2;
                return (
                  <g key={`chip-${i}`}>
                    {Math.hypot(ccx - p.x, ccy - p.y) > 16 && (
                      <line x1={p.x} y1={p.y} x2={ccx} y2={ccy} stroke={COLOR.route} strokeWidth={0.75} opacity={0.5} />
                    )}
                    <motion.g
                      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: delay + 0.05, duration: 0.3 }}
                    >
                      <foreignObject x={chip.rect.x} y={chip.rect.y} width={chip.rect.w} height={chip.rect.h}>
                        <div className="flex h-full items-center justify-center">
                          <span
                            className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold shadow-sm ${
                              chip.isDst
                                ? "bg-[#4F46E5] text-[12px] text-white"
                                : "border border-[#E5E7EB] bg-white/95 text-[9px] text-[#4F46E5]"
                            }`}
                          >
                            {chip.text}
                          </span>
                        </div>
                      </foreignObject>
                    </motion.g>
                  </g>
                );
              })}
          </g>
        )}
      </svg>

      {/* hover tooltip */}
      <AnimatePresence>
        {hovered && nodeById.get(hovered) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-[#E5E7EB] bg-white/95 px-3 py-2 text-xs shadow-sm"
          >
            <div className="text-sm font-semibold text-[#111827]">{nodeById.get(hovered)!.label}</div>
            <div className="mt-0.5 text-[#6B7280]">
              {nodeById.get(hovered)!.kind === "endpoint" ? "Endpoint" : "Repeater"} ·{" "}
              {nodeById.get(hovered)!.tier === "testbed" ? "testbed core" : "modeled extension"}
            </div>
            <div className="text-[#6B7280]">{pairCountByNode.get(hovered) ?? 0} live pairs on its links</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
