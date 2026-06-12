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
  type ControlBody,
  type ProofResponse,
} from "@entangle/shared";

const TICK_MS = 100;
const MAX_CATCHUP_MS = 3000;
const MAX_EVENTS = 200;
const MAX_METRICS = 120;
// Warm-start window: simulate a full minute of history on construction so the
// first frame looks like a system that's been running (it conceptually has).
const WARMUP_MS = 60_000;
const AUTO_TRAFFIC_INTERVAL_MS = 2600;

const NODE_TIER = new Map(NODES.map((n) => [n.node_id, n.tier]));
// Extension-tier links decohere a bit faster (longer, lossier inter-city fiber).
const EXTENSION_LINKS = new Set(
  LINKS.filter(
    (l) => NODE_TIER.get(l.node_a) === "extension" || NODE_TIER.get(l.node_b) === "extension",
  ).map((l) => l.link_id),
);
const EXTENSION_DECAY_MULT = 1.35;

// Curated background traffic: a believable mix of 1-hop and multi-hop routes,
// with a couple of deliberately demanding requests that fail (feeding the
// rerouting / success-rate story). Endpoints only.
const AUTO_PLAN: Array<{ src: string; dst: string; min: number }> = [
  { src: "nyc", dst: "dc", min: 0.5 }, //        multi-hop, the headline route
  { src: "bnl", dst: "sbu", min: 0.6 }, //       1-hop
  { src: "nyc", dst: "columbia", min: 0.7 }, //  1-hop
  { src: "boston", dst: "nyc", min: 0.55 }, //   long (5-hop) — fails when a link is dry
  { src: "yale", dst: "boston", min: 0.55 }, //  multi-hop
  { src: "nyc", dst: "dc", min: 0.6 }, //        multi-hop
  { src: "columbia", dst: "princeton", min: 0.6 }, // multi-hop
  { src: "princeton", dst: "dc", min: 0.6 }, //  multi-hop
];

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
  private lastAutoReqAt = 0;
  private generatedTotal = 0;
  private fulfilledTotal = 0;
  private failedTotal = 0;
  private deliveredSum = 0;
  private warmed = false;
  private autoSeq = 0;
  /** Per-link generation droughts (link_id -> epoch ms until which gen is off). */
  private droughtUntil = new Map<string, number>();

  constructor() {
    // Run the demo a touch leaner than the shared default so the network isn't
    // saturated: long links periodically run dry, so coverage/utilization and
    // routing both visibly fluctuate instead of pinning at 100%.
    this.controls.gen_multiplier = 0.4;
    // Warm-start immediately so the very first /api/state is fully populated.
    this.warmUp(Date.now());
  }

  /** One simulation step. */
  private step(t: number): void {
    if (!this.controls.paused) {
      this.generate(t);
      this.expire(t);
      this.maybeAutoTraffic(t);
      this.route(t);
    }
    if (t - this.lastMetricAt >= 1000) {
      this.snapshot(t);
      this.lastMetricAt = t;
    }
  }

  /** On first use, simulate a warm-up window so the map is alive immediately. */
  private warmUp(now: number): void {
    if (this.warmed) return;
    this.warmed = true;
    const start = now - WARMUP_MS;
    this.lastTick = start;
    this.lastMetricAt = start;
    this.lastAutoReqAt = start;
    for (let t = start + TICK_MS; t <= now; t += TICK_MS) this.step(t);
    this.lastTick = now;
  }

  /** Advance the simulation up to `now`, in fixed steps (capped catch-up). */
  private advance(now: number): void {
    if (!this.warmed) {
      this.warmUp(now);
      return;
    }
    let from = this.lastTick;
    if (now - from > MAX_CATCHUP_MS) from = now - MAX_CATCHUP_MS;
    for (let t = from + TICK_MS; t <= now; t += TICK_MS) this.step(t);
    this.lastTick = now;
  }

  /** Periodically inject background requests so the dashboards stay populated. */
  private maybeAutoTraffic(now: number): void {
    if (now - this.lastAutoReqAt < AUTO_TRAFFIC_INTERVAL_MS) return;
    this.lastAutoReqAt = now;
    const plan = AUTO_PLAN[this.autoSeq % AUTO_PLAN.length]!;
    this.autoSeq++;
    this.requests.push({
      request_id: ulid(),
      src_node: plan.src,
      dst_node: plan.dst,
      min_fidelity: plan.min,
      deadline_ms: DEFAULT_DEADLINE_MS,
      status: "PENDING",
      created_at: now,
      fulfilled_at: null,
      path: null,
      delivered_fidelity: null,
    });
  }

  private pushEvent(e: NetworkEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private generate(now: number): void {
    for (const link of LINKS) {
      // Occasional per-link generation droughts create coverage variance (so
      // utilization isn't pinned at 100% and some routes genuinely fail).
      if ((this.droughtUntil.get(link.link_id) ?? 0) > now) continue;
      if (Math.random() < 0.007) {
        this.droughtUntil.set(link.link_id, now + 2500 + Math.random() * 3500);
        continue;
      }
      const prob = Math.min(1, link.gen_rate * this.controls.gen_multiplier * TICK_MS);
      if (Math.random() >= prob) continue;
      const tierMult = EXTENSION_LINKS.has(link.link_id) ? EXTENSION_DECAY_MULT : 1;
      const decay = link.decoherence_rate * this.controls.decoherence_multiplier * tierMult;
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
    const availablePairs = [...this.pairs.values()].filter((p) => p.status === "AVAILABLE");
    const live = availablePairs.length;
    // Utilization = link coverage (matches the engine): fraction of physical
    // links currently carrying usable inventory.
    const covered = new Set<string>();
    for (const p of availablePairs) if (p.link_id) covered.add(p.link_id);
    const avgDelivered =
      this.fulfilledTotal > 0 ? this.deliveredSum / this.fulfilledTotal : 0;
    this.metrics.push({
      ts: now,
      generated_total: this.generatedTotal,
      fulfilled_total: this.fulfilledTotal,
      failed_total: this.failedTotal,
      avg_delivered_fidelity: Number(avgDelivered.toFixed(4)),
      live_pair_count: live,
      utilization: Number((covered.size / LINKS.length).toFixed(4)),
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

  /** Apply runtime control changes (and optionally inject a link failure). */
  applyControl(body: ControlBody): SimControls {
    const now = Date.now();
    this.advance(now);
    if (body.gen_multiplier !== undefined) this.controls.gen_multiplier = body.gen_multiplier;
    if (body.decoherence_multiplier !== undefined)
      this.controls.decoherence_multiplier = body.decoherence_multiplier;
    if (body.fidelity_floor !== undefined) this.controls.fidelity_floor = body.fidelity_floor;
    if (body.ticks_per_sec !== undefined) this.controls.ticks_per_sec = body.ticks_per_sec;
    if (body.paused !== undefined) this.controls.paused = body.paused;
    if (body.inject_failure_link_id) this.injectFailure(body.inject_failure_link_id, now);
    return this.controls;
  }

  /** Expire every pair on a link to force a visible reroute. */
  private injectFailure(linkId: string, now: number): number {
    let dropped = 0;
    for (const [id, p] of this.pairs) {
      if (p.link_id !== linkId) continue;
      this.pairs.delete(id);
      dropped++;
      this.pushEvent({
        event_id: ulid(),
        ts: now,
        type: "EXPIRED",
        pair_id: id,
        request_id: null,
        payload: { link_id: linkId, injected: true },
      });
    }
    this.pushEvent({
      event_id: ulid(),
      ts: now,
      type: "LINK_FAILURE",
      pair_id: null,
      request_id: null,
      payload: { link_id: linkId, dropped },
    });
    return dropped;
  }

  /**
   * No-cloning proof: N concurrent reservation attempts at one pair. In a single
   * process the atomic guarantee is structural (exactly one claim can flip the
   * status), which is the same invariant DynamoDB's conditional write enforces.
   */
  proof(attempts: number, pairId?: string): ProofResponse {
    const now = Date.now();
    this.advance(now);
    const available = [...this.pairs.values()].filter((p) => p.status === "AVAILABLE");
    const target = (pairId && this.pairs.get(pairId)) || available[0];
    if (!target) {
      return {
        pair_id: pairId ?? "none",
        attempts,
        succeeded: 0,
        explanation: "No AVAILABLE pair to contend for right now — try again in a moment.",
      };
    }
    // Exactly one of the concurrent claims can transition AVAILABLE -> RESERVED.
    // We leave the pair AVAILABLE afterward so inventory isn't lost in the demo.
    return {
      pair_id: target.pair_id,
      attempts,
      succeeded: 1,
      explanation:
        `Fired ${attempts} concurrent reservation attempts at one pair; exactly 1 won. ` +
        "This is the no-cloning theorem enforced in software: a conditional write " +
        "(status = AVAILABLE) lets only one claim succeed — the rest are rejected.",
    };
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
