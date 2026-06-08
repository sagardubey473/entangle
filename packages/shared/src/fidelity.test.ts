/**
 * Minimal assertion-based tests for the fidelity math. Run with `pnpm test`
 * inside packages/shared (uses tsx, no test framework needed for the demo).
 */

import assert from "node:assert/strict";
import {
  currentFidelity,
  isExpired,
  expiryTimeMs,
  expiresAtSeconds,
  pathFidelity,
} from "./fidelity.js";
import { LINKS, NODES, haversineKm, deriveLinkParams } from "./topology.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("fidelity math");

check("fidelity at t=0 equals initial", () => {
  assert.equal(currentFidelity(0.9, 1e-5, 1000, 1000), 0.9);
});

check("fidelity decays exponentially", () => {
  const f = currentFidelity(0.9, 1e-4, 0, 1000); // 0.9 * exp(-0.1)
  assert.ok(Math.abs(f - 0.9 * Math.exp(-0.1)) < 1e-9);
});

check("fidelity is clamped to [0,1]", () => {
  assert.equal(currentFidelity(1.2, 0, 0, 0), 1);
  assert.equal(currentFidelity(0.9, 1, 0, 1e9), 0);
});

check("isExpired flips at the floor", () => {
  // Choose params so fidelity is exactly 0.5 at t=1000.
  const k = Math.log(0.9 / 0.5) / 1000;
  assert.equal(isExpired(0.9, k, 0, 999, 0.5), false);
  assert.equal(isExpired(0.9, k, 0, 1001, 0.5), true);
});

check("expiryTimeMs solves for the floor crossing", () => {
  const k = 1e-4;
  const t = expiryTimeMs(0.9, k, 0, 0.5);
  const f = currentFidelity(0.9, k, 0, t);
  assert.ok(Math.abs(f - 0.5) < 1e-6);
});

check("expiryTimeMs handles already-expired and never-decay", () => {
  assert.equal(expiryTimeMs(0.4, 1e-4, 100, 0.5), 100);
  assert.equal(expiryTimeMs(0.9, 0, 100, 0.5), Infinity);
});

check("expiresAtSeconds returns Unix seconds in the future", () => {
  const s = expiresAtSeconds(0.9, 1e-4, 0, 0.5);
  assert.ok(s > 0 && Number.isInteger(s));
});

check("pathFidelity multiplies hops", () => {
  assert.ok(Math.abs(pathFidelity([0.9, 0.8, 0.95]) - 0.9 * 0.8 * 0.95) < 1e-9);
  assert.equal(pathFidelity([]), 0);
});

console.log("topology");

check("13 nodes and 12 links seeded", () => {
  assert.equal(NODES.length, 13);
  assert.equal(LINKS.length, 12);
});

check("there is NO direct nyc–dc link", () => {
  const direct = LINKS.find(
    (l) =>
      (l.node_a === "nyc" && l.node_b === "dc") ||
      (l.node_a === "dc" && l.node_b === "nyc"),
  );
  assert.equal(direct, undefined);
});

check("link params are physically plausible", () => {
  for (const l of LINKS) {
    assert.ok(l.base_fidelity >= 0.88 && l.base_fidelity <= 0.97, l.link_id);
    assert.ok(l.gen_rate > 0 && l.decoherence_rate > 0, l.link_id);
    assert.ok(l.distance_km > 0, l.link_id);
  }
});

check("haversine NYC↔DC is ~330 km great-circle", () => {
  const d = haversineKm(40.6986, -73.9698, 38.9072, -77.0369);
  assert.ok(d > 300 && d < 360, `got ${d}`);
});

check("longer links have lower fidelity than short links", () => {
  const short = deriveLinkParams(20);
  const long = deriveLinkParams(150);
  assert.ok(short.base_fidelity > long.base_fidelity);
  assert.ok(short.gen_rate > long.gen_rate);
  assert.ok(short.decoherence_rate < long.decoherence_rate);
});

console.log(`\n${passed} checks passed.`);
