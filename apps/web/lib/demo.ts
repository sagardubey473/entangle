/**
 * In-process demo simulator — lets the entire web app run and "breathe" with NO
 * AWS configured (great for local dev, Vercel previews, and the offline
 * checkpoint). It reuses the SAME shared math + topology as the real engine, so
 * what you see locally matches the AWS-backed behavior.
 *
 * When AWS *is* configured, /api/state reads the real databases instead; this
 * module is the graceful fallback. Module-level singleton state persists across
 * requests within a single server process.
 *
 * Phase 3 scope: generate / decay / expire + derived links, metrics, events.
 * Phase 4 extends this with requests, routing, swaps, and activePath.
 */

import { ulid } from "ulid";
import {
  LINKS,
  NODES,
  currentFidelity,
  expiresAtSeconds,
  endpointsKey,
  findBestRoute,
  DEFAULT_SIM_CONTROLS,
  DEFAULT_DEADLINE_MS,
  type EntangledPair,
  type ConnectionRequest,
  type MetricsSnapshot,
  type NetworkEvent,
  type StateResponse,
  type LiveLinkView,
  type SimControls,
} from "@entangle/shared";

const TICK_MS = 100;
const MAX_CATCHUP_MS = 3000;
const TOTAL_SLOTS = NODES.reduce((s, n) => s + n.memory_slots, 0);
const MAX_EVENTS = 200;
const MAX_METRICS = 120;

class DemoSim {
  private pairs = new Map<string, EntangledPair>();
  private events: NetworkEvent[] = [];
  private metrics: MetricsSnapshot[] = [];
  private requests: ConnectionRequest[] = [];
  private lastFulfilledPath: string[] = [];
  private lastFulfilledAt = 0;
  controls: SimControls = { ...DEFAULT_SIM_CONTROLS };

  private lastTick = Date.now();
  private lastMetricAt = 0;
  private generatedTotal = 0;
  private fulfilledTotal = 0;
  private failedTotal = 0;
  private deliveredSum = 0;

  /** Advance the simulation up to `now`, in fixed steps (capped catch-up). */
  private advance(now: number): void {
    let from = this.lastTick;
    if (now - from > MAX_CATCHUP_MS) from = now - MAX_CATCHUP_MS;
    for (let t = from + TICK_MS; t <= now; t += TICK_MS) {
      if (!this.controls.paused) {
        this.generate(t);
        this.expire(t);
        this.route(t);
      }
      if (t - this.lastMetricAt >= 1000) {
        this.snapshot(t);
        this.lastMetricAt = t;
      }
    }
    this.lastTick = now;
  }

  private pushEvent(e: NetworkEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private generate(now: number): void {
    for (const link of LINKS) {
      const prob = Math.min(1, link.gen_rate * this.controls.gen_multiplier * TICK_MS);
      if (Math.random() >= prob) continue;
      const decay = link.decoherence_rate * this.controls.decoherence_multiplier;
      const pair: EntangledPair = {
        pair_id: ulid(),
        node_a: link.node_a,
        node_b: link.node_b,
        link_id: link.link_id,
        initial_fidelity: link.base_fidelity,
        created_at: now,
        decay_rate: decay,
        status: "AVAILABLE",
        reserved_by: null,
        expires_at: expiresAtSeconds(link.base_fidelity, decay, now, this.controls.fidelity_floor),
        is_long_link: false,
        hop_count: 1,
        endpoints: endpointsKey(link.node_a, link.node_b),
        gsi_status: "AVAILABLE",
      };
      this.pairs.set(pair.pair_id, pair);
      this.generatedTotal++;
      this.pushEvent({
        event_id: ulid(),
        ts: now,
        type: "GENERATED",
        pair_id: pair.pair_id,
        request_id: null,
        payload: { link_id: link.link_id, fidelity: pair.initial_fidelity },
      });
    }
  }

  private expire(now: number): void {
    for (const [id, p] of this.pairs) {
      if (p.status !== "AVAILABLE") continue;
      const f = currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now);
      if (f >= this.controls.fidelity_floor) continue;
      this.pairs.delete(id);
      this.pushEvent({
        event_id: ulid(),
        ts: now,
        type: "EXPIRED",
        pair_id: id,
        request_id: null,
        payload: { link_id: p.link_id, fidelity: Number(f.toFixed(4)) },
      });
    }
  }

  private snapshot(now: number): void {
    const live = [...this.pairs.values()].filter((p) => p.status === "AVAILABLE").length;
    const avgDelivered =
      this.fulfilledTotal > 0 ? this.deliveredSum / this.fulfilledTotal : 0;
    this.metrics.push({
      ts: now,
      generated_total: this.generatedTotal,
      fulfilled_total: this.fulfilledTotal,
      failed_total: this.failedTotal,
      avg_delivered_fidelity: Number(avgDelivered.toFixed(4)),
      live_pair_count: live,
      utilization: Number(Math.min(1, (2 * live) / TOTAL_SLOTS).toFixed(4)),
    });
    if (this.metrics.length > MAX_METRICS) this.metrics.splice(0, this.metrics.length - MAX_METRICS);
  }

  /** Best AVAILABLE pair between two nodes (highest current fidelity). */
  private bestPair(a: string, b: string, now: number): EntangledPair | null {
    const key = endpointsKey(a, b);
    let best: EntangledPair | null = null;
    let bestF = 0;
    for (const p of this.pairs.values()) {
      if (p.status !== "AVAILABLE" || p.endpoints !== key) continue;
      const f = currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now);
      if (f > bestF) {
        bestF = f;
        best = p;
      }
    }
    return best;
  }

  /** Process PENDING requests: route via findBestRoute, then swap + fulfill. */
  private route(now: number): void {
    for (const req of this.requests) {
      if (req.status !== "PENDING") continue;
      if (now > req.created_at + req.deadline_ms) {
        req.status = "FAILED";
        this.failedTotal++;
        this.pushEvent({
          event_id: ulid(),
          ts: now,
          type: "FAILED",
          pair_id: null,
          request_id: req.request_id,
          payload: { reason: "deadline exceeded" },
        });
        continue;
      }
      const route = findBestRoute(this.linkViews(now), req.src_node, req.dst_node, req.min_fidelity);
      if (!route) continue;

      // Pick the best pair per hop; bail if any hop's inventory vanished.
      const hopPairs: EntangledPair[] = [];
      let ok = true;
      for (let i = 0; i < route.path.length - 1; i++) {
        const p = this.bestPair(route.path[i]!, route.path[i + 1]!, now);
        if (!p) { ok = false; break; }
        hopPairs.push(p);
      }
      if (!ok) continue;

      const product = hopPairs.reduce(
        (acc, p) => acc * currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now),
        1,
      );
      if (product < req.min_fidelity) continue;

      // Swap: consume hop pairs, emit events, deliver end-to-end.
      for (const p of hopPairs) {
        this.pairs.delete(p.pair_id);
        this.pushEvent({
          event_id: ulid(),
          ts: now,
          type: "CONSUMED",
          pair_id: p.pair_id,
          request_id: req.request_id,
          payload: { link_id: p.link_id },
        });
      }
      for (let i = 1; i < route.path.length - 1; i++) {
        this.pushEvent({
          event_id: ulid(),
          ts: now,
          type: "SWAPPED",
          pair_id: null,
          request_id: req.request_id,
          payload: { at: route.path[i] },
        });
      }
      const delivered = Number(product.toFixed(4));
      req.status = "FULFILLED";
      req.path = route.path;
      req.delivered_fidelity = delivered;
      req.fulfilled_at = now;
      this.fulfilledTotal++;
      this.deliveredSum += delivered;
      this.lastFulfilledPath = route.path;
      this.lastFulfilledAt = now;
      this.pushEvent({
        event_id: ulid(),
        ts: now,
        type: "FULFILLED",
        pair_id: null,
        request_id: req.request_id,
        payload: { path: route.path, delivered_fidelity: delivered, hops: route.hops },
      });
    }
    // Keep the requests list bounded.
    if (this.requests.length > 100) this.requests.splice(0, this.requests.length - 100);
  }

  /** Create a PENDING request (called by /api/request in demo mode). */
  createRequest(body: {
    src: string;
    dst: string;
    min_fidelity: number;
    deadline_ms?: number;
  }): ConnectionRequest {
    const now = Date.now();
    this.advance(now);
    const req: ConnectionRequest = {
      request_id: ulid(),
      src_node: body.src,
      dst_node: body.dst,
      min_fidelity: body.min_fidelity,
      deadline_ms: body.deadline_ms ?? DEFAULT_DEADLINE_MS,
      status: "PENDING",
      created_at: now,
      fulfilled_at: null,
      path: null,
      delivered_fidelity: null,
    };
    this.requests.push(req);
    return req;
  }

  /** Undirected per-edge link view with the best current fidelity. */
  private linkViews(now: number): LiveLinkView[] {
    const best = new Map<string, { fidelity: number; count: number }>();
    for (const link of LINKS) best.set(link.link_id, { fidelity: 0, count: 0 });
    for (const p of this.pairs.values()) {
      if (p.status !== "AVAILABLE" || !p.link_id) continue;
      const f = currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now);
      const slot = best.get(p.link_id);
      if (!slot) continue;
      slot.count++;
      if (f > slot.fidelity) slot.fidelity = f;
    }
    return LINKS.map((link) => {
      const slot = best.get(link.link_id)!;
      return {
        from: link.node_a,
        to: link.node_b,
        fidelity: Number(slot.fidelity.toFixed(4)),
        available_count: slot.count,
      };
    });
  }

  getState(): StateResponse {
    const now = Date.now();
    this.advance(now);
    const livePairs = [...this.pairs.values()].filter((p) => p.status === "AVAILABLE");
    const ACTIVE_PATH_WINDOW_MS = 6000;
    const activePath =
      now - this.lastFulfilledAt <= ACTIVE_PATH_WINDOW_MS ? this.lastFulfilledPath : [];
    return {
      nodes: NODES,
      links: this.linkViews(now),
      livePairs,
      activeRequests: [...this.requests].slice(-25).reverse(),
      recentEvents: [...this.events].slice(-40).reverse(),
      metrics: [...this.metrics],
      activePath,
      controls: this.controls,
    };
  }
}

// Singleton across requests within a process (survives HMR in dev via globalThis).
const g = globalThis as unknown as { __entangleDemo?: DemoSim };
export const demoSim: DemoSim = g.__entangleDemo ?? (g.__entangleDemo = new DemoSim());
