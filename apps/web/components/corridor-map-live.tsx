"use client";

import { useEffect, useMemo, useState } from "react";
import { QuantumCorridorMap, type NetworkNode, type NetworkLink } from "@/components/ui/quantum-corridor-map";

const NODES: NetworkNode[] = [
  { id: "bnl",       label: "Brookhaven Lab",  lat: 40.8690, lng: -72.8730, kind: "endpoint", tier: "testbed" },
  { id: "sbu",       label: "Stony Brook",     lat: 40.9257, lng: -73.1409, kind: "endpoint", tier: "testbed" },
  { id: "commack",   label: "Commack (RICOH)", lat: 40.8429, lng: -73.2929, kind: "repeater", tier: "testbed" },
  { id: "westbury",  label: "Westbury (LII)",  lat: 40.7557, lng: -73.5876, kind: "repeater", tier: "testbed" },
  { id: "nyc",       label: "New York City",   lat: 40.6986, lng: -73.9698, kind: "endpoint", tier: "testbed" },
  { id: "columbia",  label: "Columbia",        lat: 40.8075, lng: -73.9626, kind: "endpoint", tier: "testbed" },
  { id: "yale",      label: "Yale",            lat: 41.3163, lng: -72.9223, kind: "endpoint", tier: "testbed" },
  { id: "hartford",  label: "Hartford",        lat: 41.7658, lng: -72.6734, kind: "repeater", tier: "extension" },
  { id: "boston",    label: "Boston",          lat: 42.3601, lng: -71.0589, kind: "endpoint", tier: "extension" },
  { id: "princeton", label: "Princeton",       lat: 40.3573, lng: -74.6672, kind: "endpoint", tier: "extension" },
  { id: "philly",    label: "Philadelphia",    lat: 39.9526, lng: -75.1652, kind: "repeater", tier: "extension" },
  { id: "baltimore", label: "Baltimore",       lat: 39.2904, lng: -76.6122, kind: "repeater", tier: "extension" },
  { id: "dc",        label: "Washington DC",   lat: 38.9072, lng: -77.0369, kind: "endpoint", tier: "extension" },
];

const EDGES: [string, string][] = [
  ["bnl", "sbu"], ["sbu", "commack"], ["commack", "westbury"], ["westbury", "nyc"],
  ["nyc", "columbia"], ["commack", "yale"], ["yale", "hartford"], ["hartford", "boston"],
  ["nyc", "princeton"], ["princeton", "philly"], ["philly", "baltimore"], ["baltimore", "dc"],
];

export function CorridorMapLive() {
  const [reduced, setReduced] = useState(false);
  const [links, setLinks] = useState<NetworkLink[]>([]);
  const [activePath, setActivePath] = useState<string[]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state");
        const data = await res.json();
        if (!alive) return;
        setLinks(data.links ?? EDGES.map(([from, to]) => ({ from, to, fidelity: 0.9 })));
        setActivePath(data.activePath ?? []);
      } catch {
        setLinks(EDGES.map(([from, to]) => ({ from, to, fidelity: 0.85 })));
      }
    };
    tick();
    const id = setInterval(tick, 400);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const nodes = useMemo(() => NODES, []);

  return (
    <QuantumCorridorMap
      nodes={nodes}
      links={links}
      activePath={activePath}        // e.g. ["nyc","princeton","philly","baltimore","dc"]
      labelMode="endpoints"
      reducedMotion={reduced}
    />
  );
}
