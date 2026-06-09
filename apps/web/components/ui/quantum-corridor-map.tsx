"use client";

import { useId, useMemo, useState, type CSSProperties } from "react";
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
}

export interface NetworkLink {
  from: string;     // node id
  to: string;       // node id
  fidelity: number; // 0..1, current value (from /api/state)
}

interface QuantumCorridorMapProps {
  nodes: NetworkNode[];
  links: NetworkLink[];
  activePath?: string[];                 // ordered node ids of a fulfilled route to highlight
  labelMode?: "endpoints" | "all" | "hover";
  reducedMotion?: boolean;
  className?: string;
}

// Geographic bounds of the US East Coast corridor.
const BOUNDS = { minLat: 38.2, maxLat: 42.8, minLng: -77.8, maxLng: -70.4 };
const VIEW = { w: 800, h: 680, pad: 64 };
const CENTER_LAT = (BOUNDS.minLat + BOUNDS.maxLat) / 2;
const LNG_SCALE = Math.cos((CENTER_LAT * Math.PI) / 180); // de-stretch longitude

function fidelityColor(f: number) {
  const v = Math.max(0, Math.min(1, f));
  const stops = [
    { t: 0.0, c: [239, 68, 68] },   // #EF4444 red (low)
    { t: 0.5, c: [245, 158, 11] },  // #F59E0B amber (mid)
    { t: 1.0, c: [16, 185, 129] },  // #10B981 emerald (high)
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i].t && v <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const k = (v - a.t) / (b.t - a.t || 1);
  const ch = (i: number) => Math.round(a.c[i] + (b.c[i] - a.c[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

export function QuantumCorridorMap({
  nodes,
  links,
  activePath = [],
  labelMode = "endpoints",
  reducedMotion = false,
  className = "",
}: QuantumCorridorMapProps) {
  const uid = useId().replace(/:/g, "");
  const [hovered, setHovered] = useState<string | null>(null);

  // Uniform, shape-preserving projection that centers the corridor in the padded box.
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
    return `M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`;
  };

  const activeEdges = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i < activePath.length - 1; i++) {
      s.add([activePath[i], activePath[i + 1]].sort().join("|"));
    }
    return s;
  }, [activePath]);

  // Real Northeast US state outlines, projected with the same fn as the nodes,
  // so the corridor sits on an actual (light-themed) map of the region.
  const landPaths = useMemo(() => {
    return BASEMAP.flatMap((s) =>
      s.rings.map((ring) => {
        let d = "";
        for (let i = 0; i < ring.length; i++) {
          const lng = ring[i][0];
          const lat = ring[i][1];
          const p = project(lat, lng);
          d += `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
        }
        return d + "Z";
      }),
    );
  }, [project]);

  const showLabel = (n: NetworkNode) =>
    labelMode === "all" ||
    (labelMode === "endpoints" && n.kind === "endpoint") ||
    hovered === n.id;

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white ${className}`}>
      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" className="h-auto w-full select-none">
        <defs>
          <filter id={`glow-${uid}`}>
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* water + real Northeast US landmasses (light-themed basemap) */}
        <rect x={0} y={0} width={VIEW.w} height={VIEW.h} fill="#F1F6FB" />
        <g>
          {landPaths.map((d, i) => (
            <path key={i} d={d} fill="#E7EDF4" stroke="#CBD5E1" strokeWidth={0.75} strokeLinejoin="round" />
          ))}
        </g>

        {/* links */}
        {links.map((link, i) => {
          const a = projected.get(link.from);
          const b = projected.get(link.to);
          if (!a || !b) return null;
          const color = fidelityColor(link.fidelity);
          const isActive = activeEdges.has([link.from, link.to].sort().join("|"));
          const opacity = 0.18 + 0.72 * Math.max(0, Math.min(1, link.fidelity));
          const path = curve(a, b);
          return (
            <g key={`link-${i}`}>
              <motion.path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={isActive ? 3 : 1.6}
                strokeLinecap="round"
                style={{ opacity }}
                initial={reducedMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={reducedMotion ? { duration: 0 } : { duration: 1.1, ease: "easeInOut" }}
                filter={isActive ? `url(#glow-${uid})` : undefined}
              />
              {!reducedMotion && (isActive || link.fidelity > 0.75) && (
                <motion.circle
                  r={isActive ? 4 : 2.5}
                  fill={color}
                  initial={{ offsetDistance: "0%", opacity: 0 }}
                  animate={{ offsetDistance: ["0%", "100%"], opacity: [0, 1, 0] }}
                  transition={{ duration: isActive ? 1.4 : 2.6, repeat: Infinity, ease: "easeInOut" }}
                  style={{ offsetPath: `path('${path}')` } as unknown as CSSProperties}
                />
              )}
            </g>
          );
        })}

        {/* nodes */}
        {nodes.map((n, i) => {
          const p = projected.get(n.id);
          if (!p) return null;
          const isTestbed = n.tier === "testbed";
          const fill = n.kind === "endpoint" ? "#4F46E5" : "#0EA5E9";
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
              {isTestbed && <circle cx={p.x} cy={p.y} r={6.5} fill="none" stroke={fill} strokeWidth={1} opacity={0.6} />}
              <circle cx={p.x} cy={p.y} r={n.kind === "endpoint" ? 4.5 : 3.2} fill={fill} filter={`url(#glow-${uid})`} />
              {showLabel(n) && (
                <motion.g
                  initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reducedMotion ? 0 : 0.1 * i + 0.3, duration: 0.4 }}
                  className="pointer-events-none"
                >
                  <foreignObject x={p.x - 60} y={p.y - 30} width={120} height={24}>
                    <div className="flex h-full items-center justify-center">
                      <span className="whitespace-nowrap rounded-md border border-[#E5E7EB] bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-[#111827] shadow-sm">
                        {n.label}
                      </span>
                    </div>
                  </foreignObject>
                </motion.g>
              )}
            </g>
          );
        })}
      </svg>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-3 left-3 rounded-lg border border-[#E5E7EB] bg-white/95 px-3 py-1.5 text-sm font-medium text-[#111827] shadow-sm sm:hidden"
          >
            {nodeById.get(hovered)?.label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
