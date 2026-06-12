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

  const labelCenter = (n: NetworkNode, p: { x: number; y: number }) =>
    n.labelOffset ? { x: p.x + n.labelOffset.dx, y: p.y + n.labelOffset.dy } : { x: p.x, y: p.y - 22 };

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
            const c = labelCenter(n, p);
            const dist = Math.hypot(c.x - p.x, c.y - p.y);
            const dim = routeActive && !activePath.includes(n.id) ? 0.3 : 1;
            return (
              <g key={`label-${n.id}`} className="pointer-events-none" style={{ opacity: dim }}>
                {dist > 14 && (
                  <line x1={p.x} y1={p.y} x2={c.x} y2={c.y} stroke="#9CA3AF" strokeWidth={0.75} opacity={0.6} />
                )}
                <foreignObject x={c.x - 60} y={c.y - 12} width={120} height={24}>
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
                  {i > 0 && (isDst || !Number.isNaN(route.hopFids[i - 1])) && (
                    <motion.g
                      initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: delay + 0.05, duration: 0.3 }}
                    >
                      <foreignObject x={p.x - 44} y={p.y + (isDst ? 8 : -28)} width={88} height={22}>
                        <div className="flex h-full items-center justify-center">
                          <span
                            className={`whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold shadow-sm ${
                              isDst
                                ? "bg-[#4F46E5] text-[12px] text-white"
                                : "border border-[#E5E7EB] bg-white text-[10px] text-[#4F46E5]"
                            }`}
                          >
                            {isDst
                              ? `delivered F=${route.delivered.toFixed(2)}`
                              : `×${(route.hopFids[i - 1] ?? 0).toFixed(2)}`}
                          </span>
                        </div>
                      </foreignObject>
                    </motion.g>
                  )}
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
