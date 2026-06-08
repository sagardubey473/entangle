/**
 * The Entangle simulation engine core.
 *
 * Phase 2 scope: GENERATE pairs stochastically, let them DECAY (fidelity is
 * always computed, never stored), and EXPIRE them once they cross the floor.
 * Writes the live inventory to DynamoDB and the event ledger / routing summary /
 * metrics to Aurora. Routing + swaps arrive in Phase 4.
 *
 * The engine is the single writer in this phase, so it keeps an in-memory mirror
 * of the AVAILABLE pairs it has minted. This avoids re-reading DynamoDB every
 * tick; DynamoDB remains the durable source of truth.
 */

import { ulid } from "ulid";
import {
  LINKS,
  NODES,
  currentFidelity,
  expiresAtSeconds,
  endpointsKey,
  type EntangledPair,
  type LiveLink,
  type MetricsSnapshot,
  type NetworkEvent,
  type SimControls,
} from "@entangle/shared";
import { dynamo, repo } from "@entangle/db";

const TOTAL_MEMORY_SLOTS = NODES.reduce((s, n) => s + n.memory_slots, 0);

export class EntangleEngine {
  /** AVAILABLE pairs the engine knows about, keyed by pair_id. */
  private readonly livePairs = new Map<string, EntangledPair>();
  /** Events queued for the next batched flush to Aurora. */
  private readonly eventQueue: NetworkEvent[] = [];

  private generatedTotal = 0;
  private fulfilledTotal = 0;
  private failedTotal = 0;
  private deliveredFidelitySum = 0;

  constructor(public controls: SimControls) {}

  get livePairCount(): number {
    return this.livePairs.size;
  }

  // -------------------------------------------------------------------------
  // GENERATE
  // -------------------------------------------------------------------------

  /**
   * For each physical link, mint an AVAILABLE pair with probability
   * gen_rate * gen_multiplier * dt. Returns the number minted this tick.
   */
  async generate(now: number, dtMs: number): Promise<number> {
    let minted = 0;
    for (const link of LINKS) {
      const prob = Math.min(1, link.gen_rate * this.controls.gen_multiplier * dtMs);
      if (Math.random() >= prob) continue;

      const decayRate = link.decoherence_rate * this.controls.decoherence_multiplier;
      const pair: EntangledPair = {
        pair_id: ulid(),
        node_a: link.node_a,
        node_b: link.node_b,
        link_id: link.link_id,
        initial_fidelity: link.base_fidelity,
        created_at: now,
        decay_rate: decayRate,
        status: "AVAILABLE",
        reserved_by: null,
        expires_at: expiresAtSeconds(
          link.base_fidelity,
          decayRate,
          now,
          this.controls.fidelity_floor,
        ),
        is_long_link: false,
        hop_count: 1,
        endpoints: endpointsKey(link.node_a, link.node_b),
        gsi_status: "AVAILABLE",
      };

      try {
        await dynamo.putPair(pair);
        this.livePairs.set(pair.pair_id, pair);
        this.generatedTotal++;
        minted++;
        this.queueEvent("GENERATED", pair.pair_id, null, {
          link_id: link.link_id,
          fidelity: pair.initial_fidelity,
        });
      } catch (err) {
        console.error(`generate: failed to put pair on ${link.link_id}:`, err);
      }
    }
    return minted;
  }

  // -------------------------------------------------------------------------
  // DECAY / EXPIRE
  // -------------------------------------------------------------------------

  /** Mark any AVAILABLE pair whose computed fidelity dropped below the floor. */
  async expire(now: number): Promise<number> {
    let expired = 0;
    for (const pair of [...this.livePairs.values()]) {
      const f = currentFidelity(
        pair.initial_fidelity,
        pair.decay_rate,
        pair.created_at,
        now,
      );
      if (f >= this.controls.fidelity_floor) continue;
      try {
        await dynamo.setPairStatus(pair.pair_id, "EXPIRED");
        this.livePairs.delete(pair.pair_id);
        expired++;
        this.queueEvent("EXPIRED", pair.pair_id, null, {
          link_id: pair.link_id,
          fidelity: Number(f.toFixed(4)),
        });
      } catch (err) {
        console.error(`expire: failed to expire pair ${pair.pair_id}:`, err);
        // Keep it in the map; we'll retry next tick.
      }
    }
    return expired;
  }

  // -------------------------------------------------------------------------
  // Derived views: live_links + metrics
  // -------------------------------------------------------------------------

  /** Recompute the routing summary from the in-memory AVAILABLE pairs. */
  computeLiveLinks(now: number): LiveLink[] {
    // Seed every directed edge at zero so the map shows faded inactive links.
    const summary = new Map<string, LiveLink>();
    for (const link of LINKS) {
      for (const [from, to] of [
        [link.node_a, link.node_b],
        [link.node_b, link.node_a],
      ] as const) {
        summary.set(`${from}->${to}`, {
          from_node: from,
          to_node: to,
          best_pair_id: null,
          current_fidelity: 0,
          available_count: 0,
          updated_at: now,
        });
      }
    }

    for (const pair of this.livePairs.values()) {
      if (pair.status !== "AVAILABLE") continue;
      const f = currentFidelity(
        pair.initial_fidelity,
        pair.decay_rate,
        pair.created_at,
        now,
      );
      for (const [from, to] of [
        [pair.node_a, pair.node_b],
        [pair.node_b, pair.node_a],
      ] as const) {
        const row = summary.get(`${from}->${to}`);
        if (!row) continue;
        row.available_count++;
        if (f > row.current_fidelity) {
          row.current_fidelity = f;
          row.best_pair_id = pair.pair_id;
        }
      }
    }
    return [...summary.values()];
  }

  buildMetrics(now: number): MetricsSnapshot {
    const live = this.livePairs.size;
    // Each pair occupies one memory slot at each of its two endpoints.
    const utilization = Math.min(1, (2 * live) / TOTAL_MEMORY_SLOTS);
    const avgDelivered =
      this.fulfilledTotal > 0
        ? this.deliveredFidelitySum / this.fulfilledTotal
        : 0;
    return {
      ts: now,
      generated_total: this.generatedTotal,
      fulfilled_total: this.fulfilledTotal,
      failed_total: this.failedTotal,
      avg_delivered_fidelity: Number(avgDelivered.toFixed(4)),
      live_pair_count: live,
      utilization: Number(utilization.toFixed(4)),
    };
  }

  // -------------------------------------------------------------------------
  // Event queue + flush
  // -------------------------------------------------------------------------

  queueEvent(
    type: NetworkEvent["type"],
    pairId: string | null,
    requestId: string | null,
    payload: Record<string, unknown>,
  ): void {
    this.eventQueue.push({
      event_id: ulid(),
      ts: Date.now(),
      type,
      pair_id: pairId,
      request_id: requestId,
      payload,
    });
  }

  /** Flush queued events to Aurora (batched). Re-queues on failure. */
  async flushEvents(): Promise<void> {
    if (this.eventQueue.length === 0) return;
    const batch = this.eventQueue.splice(0, this.eventQueue.length);
    try {
      await repo.appendEvents(batch);
    } catch (err) {
      console.error("flushEvents: failed, re-queueing:", err);
      this.eventQueue.unshift(...batch);
    }
  }
}
