/**
 * Assembles the StateResponse from the live AWS databases (DynamoDB + Aurora).
 * Used when AWS is configured; otherwise /api/state falls back to the in-process
 * demo simulator (lib/demo.ts).
 */

import {
  LINKS,
  type StateResponse,
  type LiveLinkView,
  type ConnectionRequest,
} from "@entangle/shared";
import { dynamo, repo } from "@entangle/db";

/** True when the Aurora Data API target is configured. */
export function isAwsConfigured(): boolean {
  if (process.env.ENTANGLE_DEMO_MODE === "1") return false;
  return Boolean(process.env.AURORA_CLUSTER_ARN && process.env.AURORA_SECRET_ARN);
}

/** Collapse the directed live_links rows into one undirected view per edge. */
function linkViews(
  rows: Awaited<ReturnType<typeof repo.getLiveLinks>>,
): LiveLinkView[] {
  const byKey = new Map(rows.map((r) => [`${r.from_node}->${r.to_node}`, r]));
  return LINKS.map((link) => {
    const fwd = byKey.get(`${link.node_a}->${link.node_b}`);
    const rev = byKey.get(`${link.node_b}->${link.node_a}`);
    const best = fwd && rev ? (fwd.current_fidelity >= rev.current_fidelity ? fwd : rev) : (fwd ?? rev);
    return {
      from: link.node_a,
      to: link.node_b,
      fidelity: Number((best?.current_fidelity ?? 0).toFixed(4)),
      available_count: best?.available_count ?? 0,
    };
  });
}

/** The most-recently fulfilled request's path, if it's recent (for highlighting). */
function deriveActivePath(requests: ConnectionRequest[], now: number): string[] {
  const RECENT_MS = 6000;
  const latest = requests
    .filter((r) => r.status === "FULFILLED" && r.path && r.fulfilled_at)
    .sort((a, b) => (b.fulfilled_at ?? 0) - (a.fulfilled_at ?? 0))[0];
  if (!latest || !latest.path || !latest.fulfilled_at) return [];
  return now - latest.fulfilled_at <= RECENT_MS ? latest.path : [];
}

export async function assembleState(): Promise<StateResponse> {
  const now = Date.now();
  const [controls, nodes, liveLinks, events, metrics, requests, availablePairs] =
    await Promise.all([
      repo.getControls(),
      repo.getNodes(),
      repo.getLiveLinks(),
      repo.getRecentEvents(40),
      repo.getRecentMetrics(120),
      repo.getRecentRequests(25),
      dynamo.queryAvailablePairs(),
    ]);

  // Live pairs carry initial_fidelity + decay_rate + created_at; consumers
  // compute the current value with @entangle/shared (never stored).
  return {
    nodes,
    links: linkViews(liveLinks),
    livePairs: availablePairs,
    activeRequests: requests,
    recentEvents: events,
    metrics,
    activePath: deriveActivePath(requests, now),
    controls,
  };
}
