/**
 * Offline dry-run of the Phase 2 physics — no AWS required.
 *
 * Exercises the SAME shared math the engine uses (generation probability,
 * exponential decay, floor-based expiry) purely in memory so you can watch pairs
 * appear and expire before wiring up live databases. This is the offline analog
 * of the Phase 2 checkpoint ("pairs appear and expire").
 *
 * Run:  pnpm --filter @entangle/engine dryrun
 */

import { ulid } from "ulid";
import {
  LINKS,
  currentFidelity,
  expiryTimeMs,
  DEFAULT_FIDELITY_FLOOR,
  type EntangledPair,
} from "@entangle/shared";

const FLOOR = DEFAULT_FIDELITY_FLOOR;
const TICKS_PER_SEC = 10;
const DT = 1000 / TICKS_PER_SEC;
// Pairs live ~18–45s by design, so we simulate long enough to watch them expire.
// This is pure math, so the whole window runs in a fraction of a second.
const DURATION_MS = 60_000;
const REPORT_EVERY_MS = 5_000;

function mint(linkIndex: number, now: number): EntangledPair {
  const link = LINKS[linkIndex]!;
  return {
    pair_id: ulid(),
    node_a: link.node_a,
    node_b: link.node_b,
    link_id: link.link_id,
    initial_fidelity: link.base_fidelity,
    created_at: now,
    decay_rate: link.decoherence_rate,
    status: "AVAILABLE",
    reserved_by: null,
    expires_at: Math.ceil(expiryTimeMs(link.base_fidelity, link.decoherence_rate, now, FLOOR) / 1000),
    is_long_link: false,
    hop_count: 1,
    endpoints: [link.node_a, link.node_b].sort().join("#"),
    gsi_status: "AVAILABLE",
  };
}

function main(): void {
  console.log("Entangle engine — Phase 2 dry-run (no AWS)\n");
  console.log(`floor=${FLOOR}  ticks/sec=${TICKS_PER_SEC}  duration=${DURATION_MS}ms\n`);

  const live = new Map<string, EntangledPair>();
  let generated = 0;
  let expired = 0;
  let peak = 0;

  for (let now = 0; now <= DURATION_MS; now += DT) {
    // GENERATE
    for (let i = 0; i < LINKS.length; i++) {
      const prob = Math.min(1, LINKS[i]!.gen_rate * DT);
      if (Math.random() < prob) {
        const p = mint(i, now);
        live.set(p.pair_id, p);
        generated++;
      }
    }
    // EXPIRE
    for (const [id, p] of live) {
      const f = currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now);
      if (f < FLOOR) {
        live.delete(id);
        expired++;
      }
    }
    peak = Math.max(peak, live.size);

    if (now % REPORT_EVERY_MS === 0) {
      const fids = [...live.values()].map((p) =>
        currentFidelity(p.initial_fidelity, p.decay_rate, p.created_at, now),
      );
      const avg = fids.length ? fids.reduce((a, b) => a + b, 0) / fids.length : 0;
      console.log(
        `t=${String(now).padStart(5)}ms  live=${String(live.size).padStart(3)}  ` +
          `gen=${String(generated).padStart(3)}  exp=${String(expired).padStart(3)}  ` +
          `avgFidelity=${avg.toFixed(3)}`,
      );
    }
  }

  console.log(
    `\nSummary: generated=${generated}  expired=${expired}  ` +
      `still-live=${live.size}  peak-live=${peak}`,
  );
  console.log(
    expired > 0 && generated > 0
      ? "✓ Pairs both appeared and expired — Phase 2 physics behave as designed."
      : "✗ Unexpected: no generation/expiry observed.",
  );
}

main();
