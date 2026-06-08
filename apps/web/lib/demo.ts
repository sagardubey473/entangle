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
  DEFAULT_SIM_CONTROLS,
  type EntangledPair,
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
  controls: SimControls = { ...DEFAULT_SIM_CONTROLS };

  private lastTick = Date.now();
  private lastMetricAt = 0;
  private generatedTotal = 0;
  private fulfilledTotal = 0;
  private failedTotal = 0;

  /** Advance the simulation up to `now`, in fixed steps (capped catch-up). */
  private advance(now: number): void {
    let from = this.lastTick;
    if (now - from > MAX_CATCHUP_MS) from = now - MAX_CATCHUP_MS;
    for (let t = from + TICK_MS; t <= now; t += TICK_MS) {
      if (!this.controls.paused) {
        this.generate(t);
        this.expire(t);
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
    this.metrics.push({
      ts: now,
      generated_total: this.generatedTotal,
      fulfilled_total: this.fulfilledTotal,
      failed_total: this.failedTotal,
      avg_delivered_fidelity: 0,
      live_pair_count: live,
      utilization: Number(Math.min(1, (2 * live) / TOTAL_SLOTS).toFixed(4)),
    });
    if (this.metrics.length > MAX_METRICS) this.metrics.splice(0, this.metrics.length - MAX_METRICS);
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
    return {
      nodes: NODES,
      links: this.linkViews(now),
      livePairs,
      activeRequests: [],
      recentEvents: [...this.events].slice(-40).reverse(),
      metrics: [...this.metrics],
      activePath: [],
      controls: this.controls,
    };
  }
}

// Singleton across requests within a process (survives HMR in dev via globalThis).
const g = globalThis as unknown as { __entangleDemo?: DemoSim };
export const demoSim: DemoSim = g.__entangleDemo ?? (g.__entangleDemo = new DemoSim());
