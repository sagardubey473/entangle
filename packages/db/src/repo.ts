/**
 * Repository layer — typed, intention-revealing operations over Aurora, built on
 * the low-level aurora.* primitives. Shared by the engine (writer) and the web
 * app (reader). Routing/request helpers are added in Phase 4.
 */

import {
  DEFAULT_SIM_CONTROLS,
  ROUTE_QUERY_SQL,
  MAX_HOPS,
  type ConnectionRequest,
  type LiveLink,
  type MetricsSnapshot,
  type NetworkEvent,
  type QuantumNode,
  type RouteResult,
  type SimControls,
} from "@entangle/shared";
import { exec, query, batchExec, str, num, bool, json } from "./aurora.js";

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

interface ControlsRow {
  ticks_per_sec: number;
  gen_multiplier: number;
  decoherence_multiplier: number;
  fidelity_floor: number;
  paused: boolean;
}

export async function getControls(): Promise<SimControls> {
  const rows = await query<ControlsRow>(
    `SELECT ticks_per_sec, gen_multiplier, decoherence_multiplier, fidelity_floor, paused
     FROM sim_controls WHERE id = 'controls'`,
  );
  const r = rows[0];
  if (!r) return { ...DEFAULT_SIM_CONTROLS };
  return {
    ticks_per_sec: r.ticks_per_sec,
    gen_multiplier: r.gen_multiplier,
    decoherence_multiplier: r.decoherence_multiplier,
    fidelity_floor: r.fidelity_floor,
    paused: r.paused,
  };
}

export async function updateControls(patch: Partial<SimControls>): Promise<void> {
  const sets: string[] = [];
  const params = [];
  if (patch.ticks_per_sec !== undefined) {
    sets.push("ticks_per_sec = :tps");
    params.push(num("tps", patch.ticks_per_sec));
  }
  if (patch.gen_multiplier !== undefined) {
    sets.push("gen_multiplier = :gen");
    params.push(num("gen", patch.gen_multiplier));
  }
  if (patch.decoherence_multiplier !== undefined) {
    sets.push("decoherence_multiplier = :dec");
    params.push(num("dec", patch.decoherence_multiplier));
  }
  if (patch.fidelity_floor !== undefined) {
    sets.push("fidelity_floor = :floor");
    params.push(num("floor", patch.fidelity_floor));
  }
  if (patch.paused !== undefined) {
    sets.push("paused = :paused");
    params.push(bool("paused", patch.paused));
  }
  if (sets.length === 0) return;
  sets.push("updated_at = now()");
  await exec(`UPDATE sim_controls SET ${sets.join(", ")} WHERE id = 'controls'`, params);
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export async function getNodes(): Promise<QuantumNode[]> {
  return query<QuantumNode>(
    `SELECT node_id, name, lat, lng, kind, tier, memory_slots FROM nodes ORDER BY node_id`,
  );
}

// ---------------------------------------------------------------------------
// Events (append-only)
// ---------------------------------------------------------------------------

export async function appendEvents(events: NetworkEvent[]): Promise<void> {
  await batchExec(
    `INSERT INTO events (event_id, ts, type, pair_id, request_id, payload)
     VALUES (:event_id, to_timestamp(:ts / 1000.0), :type, :pair_id, :request_id, :payload::jsonb)`,
    events.map((e) => [
      str("event_id", e.event_id),
      num("ts", e.ts),
      str("type", e.type),
      str("pair_id", e.pair_id),
      str("request_id", e.request_id),
      json("payload", e.payload),
    ]),
  );
}

interface EventRow {
  event_id: string;
  ts: string;
  type: NetworkEvent["type"];
  pair_id: string | null;
  request_id: string | null;
  payload: Record<string, unknown> | null;
}

export async function getRecentEvents(limit = 40): Promise<NetworkEvent[]> {
  const rows = await query<EventRow>(
    `SELECT event_id, extract(epoch from ts) * 1000 AS ts, type, pair_id, request_id, payload
     FROM events ORDER BY ts DESC LIMIT :lim`,
    [num("lim", limit)],
  );
  return rows.map((r) => ({
    event_id: r.event_id,
    ts: Number(r.ts),
    type: r.type,
    pair_id: r.pair_id,
    request_id: r.request_id,
    payload: r.payload ?? {},
  }));
}

// ---------------------------------------------------------------------------
// Live links (engine-maintained routing summary)
// ---------------------------------------------------------------------------

export async function flushLiveLinks(rows: LiveLink[]): Promise<void> {
  await batchExec(
    `INSERT INTO live_links (from_node, to_node, best_pair_id, current_fidelity, available_count, updated_at)
     VALUES (:from_node, :to_node, :best_pair_id, :current_fidelity, :available_count, :updated_at)
     ON CONFLICT (from_node, to_node) DO UPDATE SET
       best_pair_id = EXCLUDED.best_pair_id,
       current_fidelity = EXCLUDED.current_fidelity,
       available_count = EXCLUDED.available_count,
       updated_at = EXCLUDED.updated_at`,
    rows.map((r) => [
      str("from_node", r.from_node),
      str("to_node", r.to_node),
      str("best_pair_id", r.best_pair_id),
      num("current_fidelity", r.current_fidelity),
      num("available_count", r.available_count),
      num("updated_at", r.updated_at),
    ]),
  );
}

export async function getLiveLinks(): Promise<LiveLink[]> {
  const rows = await query<{
    from_node: string;
    to_node: string;
    best_pair_id: string | null;
    current_fidelity: number;
    available_count: number;
    updated_at: number;
  }>(
    `SELECT from_node, to_node, best_pair_id, current_fidelity, available_count, updated_at
     FROM live_links`,
  );
  return rows.map((r) => ({ ...r }));
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function insertMetrics(m: MetricsSnapshot): Promise<void> {
  await exec(
    `INSERT INTO metrics_snapshots
       (ts, generated_total, fulfilled_total, failed_total, avg_delivered_fidelity, live_pair_count, utilization)
     VALUES (to_timestamp(:ts / 1000.0), :gen, :ful, :fail, :avgf, :live, :util)
     ON CONFLICT (ts) DO NOTHING`,
    [
      num("ts", m.ts),
      num("gen", m.generated_total),
      num("ful", m.fulfilled_total),
      num("fail", m.failed_total),
      num("avgf", m.avg_delivered_fidelity),
      num("live", m.live_pair_count),
      num("util", m.utilization),
    ],
  );
}

interface MetricsRow {
  ts: string;
  generated_total: number;
  fulfilled_total: number;
  failed_total: number;
  avg_delivered_fidelity: number;
  live_pair_count: number;
  utilization: number;
}

export async function getRecentMetrics(limit = 60): Promise<MetricsSnapshot[]> {
  const rows = await query<MetricsRow>(
    `SELECT extract(epoch from ts) * 1000 AS ts, generated_total, fulfilled_total, failed_total,
            avg_delivered_fidelity, live_pair_count, utilization
     FROM metrics_snapshots ORDER BY ts DESC LIMIT :lim`,
    [num("lim", limit)],
  );
  // Return chronological (oldest first) for charts.
  return rows
    .map((r) => ({
      ts: Number(r.ts),
      generated_total: r.generated_total,
      fulfilled_total: r.fulfilled_total,
      failed_total: r.failed_total,
      avg_delivered_fidelity: r.avg_delivered_fidelity,
      live_pair_count: r.live_pair_count,
      utilization: r.utilization,
    }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Requests (read side here; create/route/fulfill added in Phase 4)
// ---------------------------------------------------------------------------

interface RequestRow {
  request_id: string;
  src_node: string;
  dst_node: string;
  min_fidelity: number;
  deadline_ms: number;
  status: ConnectionRequest["status"];
  created_at: number;
  fulfilled_at: number | null;
  path: string[] | null;
  delivered_fidelity: number | null;
}

export async function createRequest(req: {
  request_id: string;
  src_node: string;
  dst_node: string;
  min_fidelity: number;
  deadline_ms: number;
  created_at: number;
}): Promise<void> {
  await exec(
    `INSERT INTO requests (request_id, src_node, dst_node, min_fidelity, deadline_ms, status, created_at)
     VALUES (:id, :src, :dst, :minf, :deadline, 'PENDING', :created)`,
    [
      str("id", req.request_id),
      str("src", req.src_node),
      str("dst", req.dst_node),
      num("minf", req.min_fidelity),
      num("deadline", req.deadline_ms),
      num("created", req.created_at),
    ],
  );
}

export async function getPendingRequests(): Promise<ConnectionRequest[]> {
  const rows = await query<RequestRow>(
    `SELECT request_id, src_node, dst_node, min_fidelity, deadline_ms, status,
            created_at, fulfilled_at, path, delivered_fidelity
     FROM requests WHERE status = 'PENDING' ORDER BY created_at ASC`,
  );
  return rows.map((r) => ({
    request_id: r.request_id,
    src_node: r.src_node,
    dst_node: r.dst_node,
    min_fidelity: r.min_fidelity,
    deadline_ms: Number(r.deadline_ms),
    status: r.status,
    created_at: Number(r.created_at),
    fulfilled_at: r.fulfilled_at === null ? null : Number(r.fulfilled_at),
    path: r.path,
    delivered_fidelity: r.delivered_fidelity,
  }));
}

export async function markRequestFulfilled(
  requestId: string,
  path: string[],
  deliveredFidelity: number,
  fulfilledAt: number,
): Promise<void> {
  await exec(
    `UPDATE requests SET status = 'FULFILLED', path = :path::jsonb,
       delivered_fidelity = :df, fulfilled_at = :fa
     WHERE request_id = :id AND status = 'PENDING'`,
    [
      json("path", path),
      num("df", deliveredFidelity),
      num("fa", fulfilledAt),
      str("id", requestId),
    ],
  );
}

export async function markRequestFailed(requestId: string): Promise<void> {
  await exec(
    `UPDATE requests SET status = 'FAILED' WHERE request_id = :id AND status = 'PENDING'`,
    [str("id", requestId)],
  );
}

/**
 * Run the recursive-CTE route query (the maximum-product-fidelity path over
 * live_links). Returns the best route, or null if none qualifies.
 */
export async function runRoute(
  src: string,
  dst: string,
  minFidelity: number,
): Promise<RouteResult | null> {
  const rows = await query<{ path: string[]; end_to_end_fidelity: number; hops: number }>(
    ROUTE_QUERY_SQL,
    [
      str("src", src),
      str("dst", dst),
      num("min_fidelity", minFidelity),
      num("max_hops", MAX_HOPS),
    ],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    path: r.path,
    end_to_end_fidelity: Number(r.end_to_end_fidelity),
    hops: Number(r.hops),
  };
}

export async function getRecentRequests(limit = 25): Promise<ConnectionRequest[]> {
  const rows = await query<RequestRow>(
    `SELECT request_id, src_node, dst_node, min_fidelity, deadline_ms, status,
            created_at, fulfilled_at, path, delivered_fidelity
     FROM requests ORDER BY created_at DESC LIMIT :lim`,
    [num("lim", limit)],
  );
  return rows.map((r) => ({
    request_id: r.request_id,
    src_node: r.src_node,
    dst_node: r.dst_node,
    min_fidelity: r.min_fidelity,
    deadline_ms: Number(r.deadline_ms),
    status: r.status,
    created_at: Number(r.created_at),
    fulfilled_at: r.fulfilled_at === null ? null : Number(r.fulfilled_at),
    path: r.path,
    delivered_fidelity: r.delivered_fidelity,
  }));
}
