/**
 * Canonical seed topology — the US EAST COAST QUANTUM CORRIDOR.
 *
 * The northern core models the real Long Island / NY quantum testbed
 * (NYSQIT / SCY-QNet: Stony Brook University, Brookhaven National Lab, Columbia,
 * Yale — ~300 km of fiber). The southern spine models the inter-city extension
 * those operators describe as the goal. lat/lng are real. We MODEL this testbed;
 * we do not connect to it.
 *
 * Physical link parameters (base_fidelity, gen_rate, decoherence_rate) are
 * DERIVED from fiber distance by documented formulas below, tuned so that long
 * hops decay quickly and direct long-distance connections usually fail — making
 * routing through repeaters meaningful. There is deliberately NO direct nyc–dc
 * link: that connection must be built by entanglement swapping along the chain.
 */

import type { PhysicalLink, QuantumNode } from "./types.js";

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

interface SeedNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: QuantumNode["kind"];
  tier: QuantumNode["tier"];
}

const SEED_NODES: SeedNode[] = [
  // TESTBED CORE (tier = 'testbed') — the real Long Island / NYC testbed.
  { id: "bnl", name: "Brookhaven National Lab", lat: 40.869, lng: -72.873, kind: "endpoint", tier: "testbed" },
  { id: "sbu", name: "Stony Brook University", lat: 40.9257, lng: -73.1409, kind: "endpoint", tier: "testbed" },
  { id: "commack", name: "RICOH Data Center, Commack", lat: 40.8429, lng: -73.2929, kind: "repeater", tier: "testbed" },
  { id: "westbury", name: "Long Island Interconnect, Westbury", lat: 40.7557, lng: -73.5876, kind: "repeater", tier: "testbed" },
  { id: "nyc", name: "New York City (Brooklyn Navy Yard)", lat: 40.6986, lng: -73.9698, kind: "endpoint", tier: "testbed" },
  { id: "columbia", name: "Columbia University, NYC", lat: 40.8075, lng: -73.9626, kind: "endpoint", tier: "testbed" },
  { id: "yale", name: "Yale University, New Haven CT", lat: 41.3163, lng: -72.9223, kind: "endpoint", tier: "testbed" },
  // INTER-CITY EXTENSION (tier = 'extension').
  { id: "hartford", name: "Hartford CT", lat: 41.7658, lng: -72.6734, kind: "repeater", tier: "extension" },
  { id: "boston", name: "Boston MA", lat: 42.3601, lng: -71.0589, kind: "endpoint", tier: "extension" },
  { id: "princeton", name: "Princeton NJ", lat: 40.3573, lng: -74.6672, kind: "endpoint", tier: "extension" },
  { id: "philly", name: "Philadelphia PA", lat: 39.9526, lng: -75.1652, kind: "repeater", tier: "extension" },
  { id: "baltimore", name: "Baltimore MD", lat: 39.2904, lng: -76.6122, kind: "repeater", tier: "extension" },
  { id: "dc", name: "Washington DC", lat: 38.9072, lng: -77.0369, kind: "endpoint", tier: "extension" },
];

/** Repeaters hold more memory slots than endpoints (they stitch multiple pairs). */
function memorySlotsFor(kind: QuantumNode["kind"]): number {
  return kind === "repeater" ? 8 : 4;
}

export const NODES: QuantumNode[] = SEED_NODES.map((n) => ({
  node_id: n.id,
  name: n.name,
  lat: n.lat,
  lng: n.lng,
  kind: n.kind,
  tier: n.tier,
  memory_slots: memorySlotsFor(n.kind),
}));

// ---------------------------------------------------------------------------
// Physical fiber edges (bidirectional). NOTE: there is NO direct nyc–dc edge.
// ---------------------------------------------------------------------------

const EDGE_PAIRS: Array<[string, string]> = [
  ["bnl", "sbu"],
  ["sbu", "commack"],
  ["commack", "westbury"],
  ["westbury", "nyc"],
  ["nyc", "columbia"],
  ["commack", "yale"],
  ["yale", "hartford"],
  ["hartford", "boston"],
  ["nyc", "princeton"],
  ["princeton", "philly"],
  ["philly", "baltimore"],
  ["baltimore", "dc"],
];

// ---------------------------------------------------------------------------
// Geometry + derived physical parameters
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Fiber follows the ground, not a straight line. We inflate the great-circle
 * distance by a routing factor to approximate real fiber length.
 */
const FIBER_ROUTING_FACTOR = 1.15;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Derive a link's physical parameters from its fiber distance. Longer fiber:
 *  - lower base_fidelity (more loss),
 *  - lower gen_rate (entanglement generation rate falls with distance),
 *  - higher decoherence_rate (pairs decay faster).
 *
 * Tuned so pairs live ~18–45 s of (slowed) virtual time and a 4-hop NYC→DC route
 * is achievable when fresh but tight once links have aged.
 */
export function deriveLinkParams(distanceKm: number): {
  base_fidelity: number;
  gen_rate: number;
  decoherence_rate: number;
} {
  const base_fidelity = clamp(0.985 - distanceKm * 0.0007, 0.88, 0.97);
  const gen_rate = clamp(0.004 - distanceKm * 0.00002, 0.0008, 0.004);
  const decoherence_rate = 1.2e-5 + distanceKm * 1.3e-7;
  return {
    base_fidelity: Number(base_fidelity.toFixed(4)),
    gen_rate: Number(gen_rate.toFixed(6)),
    decoherence_rate: Number(decoherence_rate.toExponential(4)),
  };
}

/** Stable link id from an unordered node pair. */
export function linkId(a: string, b: string): string {
  return [a, b].sort().join("--");
}

/** Sorted "A#B" endpoint key (matches the DynamoDB `endpoints` attribute). */
export function endpointsKey(a: string, b: string): string {
  return [a, b].sort().join("#");
}

const nodeById = new Map(NODES.map((n) => [n.node_id, n]));

export const LINKS: PhysicalLink[] = EDGE_PAIRS.map(([a, b]) => {
  const na = nodeById.get(a);
  const nb = nodeById.get(b);
  if (!na || !nb) throw new Error(`Unknown node in edge: ${a}–${b}`);
  const distance_km = Number(
    (haversineKm(na.lat, na.lng, nb.lat, nb.lng) * FIBER_ROUTING_FACTOR).toFixed(1),
  );
  const params = deriveLinkParams(distance_km);
  return {
    link_id: linkId(a, b),
    node_a: a,
    node_b: b,
    distance_km,
    ...params,
  };
});

/** Convenience lookup: link_id -> PhysicalLink. */
export const LINK_BY_ID = new Map(LINKS.map((l) => [l.link_id, l]));
