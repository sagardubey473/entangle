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
  currentFidelity,
  expiresAtSeconds,
  endpointsKey,
  type EntangledPair,
  type LiveLink,
  type MetricsSnapshot,
  type NetworkEvent,
  type SimControls,
} from "@entangle/shared";
import { dynamo, repo, PairUnavailableError } from "@entangle/db";

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
  // ROUTE + RESERVE + SWAP (Phase 4)
  // -------------------------------------------------------------------------

  /** Best AVAILABLE in-memory pair between two nodes (highest current fidelity). */
  private bestAvailablePair(a: string, b: string, now: number): EntangledPair | null {
    const key = endpointsKey(a, b);
    let best: EntangledPair | null = null;
    let bestF = 0;
    for (const p of this.livePairs.values()) {
      if (p.status !== "AVAILABLE" || p.endpoints !== key) continue;
      const f = currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now);
      if (f > bestF) {
        bestF = f;
        best = p;
      }
    }
    return best;
  }

  /**
   * Process every PENDING request: fail those past deadline; for the rest, run
   * the Aurora recursive-CTE route query and try to fulfill via atomic
   * reservation + swapping. Lost races / partial reservations are released and
   * retried on a later tick.
   */
  async routeRequests(now: number): Promise<void> {
    let pending: Awaited<ReturnType<typeof repo.getPendingRequests>>;
    try {
      pending = await repo.getPendingRequests();
    } catch (err) {
      console.error("\nrouteRequests: failed to load pending:", err);
      return;
    }

    for (const req of pending) {
      if (now > req.created_at + req.deadline_ms) {
        await this.failRequest(req.request_id, "deadline exceeded");
        continue;
      }
      let route;
      try {
        route = await repo.runRoute(req.src_node, req.dst_node, req.min_fidelity);
      } catch (err) {
        console.error(`\nrouteRequests: route query failed for ${req.request_id}:`, err);
        continue;
      }
      if (!route) continue; // no path right now — retry next tick
      await this.fulfill(req, route.path, now);
    }
  }

  private async failRequest(requestId: string, reason: string): Promise<void> {
    try {
      await repo.markRequestFailed(requestId);
      this.failedTotal++;
      this.queueEvent("FAILED", null, requestId, { reason });
    } catch (err) {
      console.error(`\nfailRequest ${requestId}:`, err);
    }
  }

  /**
   * Try to fulfill `req` along `path`: reserve every hop pair atomically, swap
   * (consume intermediates), deliver one end-to-end pair, and mark FULFILLED.
   * Any reservation loss or fidelity shortfall releases all and bails (retry).
   */
  private async fulfill(
    req: { request_id: string; src_node: string; dst_node: string; min_fidelity: number },
    path: string[],
    now: number,
  ): Promise<void> {
    // 1. Pick the best in-memory pair for each hop.
    const hopPairs: EntangledPair[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const pair = this.bestAvailablePair(path[i]!, path[i + 1]!, now);
      if (!pair) return; // inventory gone since the route query — retry next tick
      hopPairs.push(pair);
    }

    // 2. Reserve each atomically (no-cloning enforced by conditional write).
    const reserved: EntangledPair[] = [];
    try {
      for (const pair of hopPairs) {
        await dynamo.allocatePair(pair.pair_id, req.request_id);
        pair.status = "RESERVED";
        pair.reserved_by = req.request_id;
        reserved.push(pair);
        this.queueEvent("RESERVED", pair.pair_id, req.request_id, { link_id: pair.link_id });
      }
    } catch (err) {
      if (err instanceof PairUnavailableError) {
        await this.releaseAll(reserved, req.request_id);
        return; // lost a race — retry next tick
      }
      await this.releaseAll(reserved, req.request_id);
      console.error(`\nfulfill ${req.request_id}: reservation error:`, err);
      return;
    }

    // 3. End-to-end fidelity = product of the reserved pairs' current fidelities.
    const product = reserved.reduce(
      (acc, p) => acc * currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now),
      1,
    );
    if (product < req.min_fidelity) {
      await this.releaseAll(reserved, req.request_id);
      return; // degraded below threshold — release and retry
    }

    // 4. Swap: consume every intermediate pair, emit swap events.
    try {
      for (const pair of reserved) {
        await dynamo.setPairStatus(pair.pair_id, "CONSUMED");
        this.livePairs.delete(pair.pair_id);
        this.queueEvent("CONSUMED", pair.pair_id, req.request_id, { link_id: pair.link_id });
      }
      for (let i = 1; i < path.length - 1; i++) {
        this.queueEvent("SWAPPED", null, req.request_id, { at: path[i] });
      }

      // 5. Deliver one end-to-end pair (ledger artifact; consumed on delivery).
      const longPair: EntangledPair = {
        pair_id: ulid(),
        node_a: req.src_node,
        node_b: req.dst_node,
        link_id: null,
        initial_fidelity: Number(product.toFixed(4)),
        created_at: now,
        decay_rate: 0,
        status: "CONSUMED",
        reserved_by: req.request_id,
        expires_at: Math.ceil(now / 1000) + 60,
        is_long_link: true,
        hop_count: path.length - 1,
        endpoints: endpointsKey(req.src_node, req.dst_node),
        gsi_status: "CONSUMED",
      };
      await dynamo.putPair(longPair);

      // 6. Mark fulfilled.
      const delivered = Number(product.toFixed(4));
      await repo.markRequestFulfilled(req.request_id, path, delivered, now);
      this.fulfilledTotal++;
      this.deliveredFidelitySum += delivered;
      this.queueEvent("FULFILLED", longPair.pair_id, req.request_id, {
        path,
        delivered_fidelity: delivered,
        hops: path.length - 1,
      });
    } catch (err) {
      console.error(`\nfulfill ${req.request_id}: swap/deliver error:`, err);
      // Pairs already consumed can't be released; leave request PENDING to retry
      // is unsafe here, so fail it explicitly.
      await this.failRequest(req.request_id, "swap failed");
    }
  }

  private async releaseAll(pairs: EntangledPair[], requestId: string): Promise<void> {
    for (const pair of pairs) {
      try {
        await dynamo.releasePair(pair.pair_id, requestId);
        pair.status = "AVAILABLE";
        pair.reserved_by = null;
      } catch (err) {
        console.error(`\nreleaseAll: failed to release ${pair.pair_id}:`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Inject link failure (operator action -> visible reroute)
  // -------------------------------------------------------------------------

  /** Expire every live pair on a link, forcing pending requests to reroute. */
  async injectFailure(linkId: string, now: number): Promise<number> {
    let dropped = 0;
    for (const pair of [...this.livePairs.values()]) {
      if (pair.link_id !== linkId) continue;
      try {
        await dynamo.setPairStatus(pair.pair_id, "EXPIRED");
        this.livePairs.delete(pair.pair_id);
        dropped++;
        this.queueEvent("EXPIRED", pair.pair_id, null, { link_id: linkId, injected: true });
      } catch (err) {
        console.error(`\ninjectFailure: failed to expire ${pair.pair_id}:`, err);
      }
    }
    this.queueEvent("LINK_FAILURE", null, null, { link_id: linkId, dropped });
    return dropped;
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
    // Utilization = mean link provisioning vs. a target inventory depth (a link
    // with >= TARGET_DEPTH usable pairs is fully provisioned). Thin links
    // contribute proportionally, so this sits believably below 100% and dips
    // when links decohere or are failed.
    const TARGET_DEPTH = 8;
    const perLink = new Map<string, number>();
    for (const p of this.livePairs.values()) {
      if (p.status === "AVAILABLE" && p.link_id) {
        perLink.set(p.link_id, (perLink.get(p.link_id) ?? 0) + 1);
      }
    }
    const utilization =
      LINKS.reduce((a, l) => a + Math.min(perLink.get(l.link_id) ?? 0, TARGET_DEPTH) / TARGET_DEPTH, 0) /
      LINKS.length;
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
