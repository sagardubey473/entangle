/**
 * Shared domain types for Entangle — the control plane for a simulated quantum
 * network. These types are the single source of truth shared by the simulation
 * engine (packages/engine) and the web app (apps/web). No duplication elsewhere.
 *
 * NOTE: the quantum layer is *simulated* on a deliberately slowed timescale. The
 * orchestration modeled by these types — perishable, non-copyable, consume-on-use
 * inventory and end-to-end routing across repeaters — is the real artifact.
 */

// ---------------------------------------------------------------------------
// Topology (Aurora: nodes, links)
// ---------------------------------------------------------------------------

export type NodeKind = "endpoint" | "repeater";
export type NodeTier = "testbed" | "extension";

export interface QuantumNode {
  node_id: string;
  name: string;
  lat: number;
  lng: number;
  kind: NodeKind;
  tier: NodeTier;
  /** Number of quantum-memory slots this node can hold pairs in. */
  memory_slots: number;
}

export interface PhysicalLink {
  link_id: string;
  node_a: string;
  node_b: string;
  distance_km: number;
  /** Fidelity of a freshly-minted pair on this link, 0..1. */
  base_fidelity: number;
  /** Probability per millisecond that a pair is generated on this link. */
  gen_rate: number;
  /** Per-millisecond decoherence (decay) rate applied to pairs on this link. */
  decoherence_rate: number;
}

// ---------------------------------------------------------------------------
// Entangled pairs (DynamoDB: EntangledPairs)
// ---------------------------------------------------------------------------

export type PairStatus = "AVAILABLE" | "RESERVED" | "CONSUMED" | "EXPIRED";

export interface EntangledPair {
  /** ULID — globally sortable, unique. There is exactly ONE of each pair. */
  pair_id: string;
  node_a: string;
  node_b: string;
  /** Physical link this pair belongs to, or null for a swap-created long link. */
  link_id: string | null;
  /** Fidelity at creation, 0..1. Never mutated. */
  initial_fidelity: number;
  /** Epoch milliseconds the pair was created. */
  created_at: number;
  /** Per-millisecond decay rate. Current fidelity is COMPUTED, never stored. */
  decay_rate: number;
  status: PairStatus;
  /** request_id that holds the reservation, or null. */
  reserved_by: string | null;
  /** Epoch SECONDS — used by DynamoDB TTL to auto-delete expired pairs. */
  expires_at: number;
  /** True if this pair is a long-distance link created by entanglement swapping. */
  is_long_link: boolean;
  /** Number of physical hops stitched into this pair (1 for a direct pair). */
  hop_count: number;
  /** Sorted "A#B" endpoint key for GSI1 lookups. */
  endpoints: string;
  /** Mirror of `status` used as the GSI2 partition key. */
  gsi_status: PairStatus;
}

// ---------------------------------------------------------------------------
// Requests (Aurora: requests)
// ---------------------------------------------------------------------------

export type RequestStatus = "PENDING" | "FULFILLED" | "FAILED";

export interface ConnectionRequest {
  request_id: string;
  src_node: string;
  dst_node: string;
  min_fidelity: number;
  /** Deadline relative to created_at, in milliseconds. */
  deadline_ms: number;
  status: RequestStatus;
  created_at: number;
  fulfilled_at: number | null;
  /** Ordered list of node ids that the fulfilled route traversed. */
  path: string[] | null;
  delivered_fidelity: number | null;
}

// ---------------------------------------------------------------------------
// Events (Aurora: events) — append-only ledger
// ---------------------------------------------------------------------------

export type EventType =
  | "GENERATED"
  | "EXPIRED"
  | "RESERVED"
  | "CONSUMED"
  | "SWAPPED"
  | "FULFILLED"
  | "FAILED"
  | "LINK_FAILURE"
  | "CONTROL";

export interface NetworkEvent {
  event_id: string;
  ts: number;
  type: EventType;
  pair_id: string | null;
  request_id: string | null;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Routing summary (Aurora: live_links) — engine-maintained
// ---------------------------------------------------------------------------

export interface LiveLink {
  from_node: string;
  to_node: string;
  best_pair_id: string | null;
  current_fidelity: number;
  available_count: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Metrics (Aurora: metrics_snapshots)
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  ts: number;
  generated_total: number;
  fulfilled_total: number;
  failed_total: number;
  avg_delivered_fidelity: number;
  live_pair_count: number;
  utilization: number;
}

// ---------------------------------------------------------------------------
// Runtime-tunable simulation controls
// ---------------------------------------------------------------------------

export interface SimControls {
  ticks_per_sec: number;
  gen_multiplier: number;
  decoherence_multiplier: number;
  fidelity_floor: number;
  paused: boolean;
}

// ---------------------------------------------------------------------------
// API contracts (apps/web)
// ---------------------------------------------------------------------------

/** A link as the map consumes it: current (decayed) fidelity at read time. */
export interface LiveLinkView {
  from: string;
  to: string;
  fidelity: number;
  available_count: number;
}

export interface StateResponse {
  nodes: QuantumNode[];
  links: LiveLinkView[];
  livePairs: EntangledPair[];
  activeRequests: ConnectionRequest[];
  recentEvents: NetworkEvent[];
  metrics: MetricsSnapshot[];
  /** Ordered node ids of the most-recently-fulfilled route, for highlighting. */
  activePath: string[];
  controls: SimControls;
}

export interface CreateRequestBody {
  src: string;
  dst: string;
  min_fidelity: number;
  deadline_ms?: number;
}

export interface ControlBody {
  gen_multiplier?: number;
  decoherence_multiplier?: number;
  fidelity_floor?: number;
  ticks_per_sec?: number;
  paused?: boolean;
  /** Expire every pair on this link to force a visible reroute. */
  inject_failure_link_id?: string;
}

export interface ProofBody {
  /** How many concurrent reservation attempts to fire at a single pair. */
  attempts: number;
  /** Optionally target a specific pair; otherwise the API picks an AVAILABLE one. */
  pair_id?: string;
}

export interface ProofResponse {
  pair_id: string;
  attempts: number;
  succeeded: number;
  explanation: string;
}
