/**
 * Tests for the in-memory router (the pure equivalent of the recursive-CTE
 * route query). Run via `pnpm test` in packages/shared.
 */

import assert from "node:assert/strict";
import { findBestRoute, MAX_HOPS, type RoutableEdge } from "./routing.js";
import { LINKS } from "./topology.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Build a fully-available edge set from the real topology (all at base fidelity).
const fullEdges: RoutableEdge[] = LINKS.map((l) => ({
  from: l.node_a,
  to: l.node_b,
  fidelity: l.base_fidelity,
  available_count: 5,
}));

console.log("routing");

check("NYC→DC routes through the repeater chain (no direct edge)", () => {
  const r = findBestRoute(fullEdges, "nyc", "dc", 0.5);
  assert.ok(r, "expected a route");
  assert.deepEqual(r!.path, ["nyc", "princeton", "philly", "baltimore", "dc"]);
  assert.equal(r!.hops, 4);
  assert.ok(r!.end_to_end_fidelity > 0.5 && r!.end_to_end_fidelity < 0.8);
});

check("end-to-end fidelity equals product of hops", () => {
  const r = findBestRoute(fullEdges, "nyc", "dc", 0.5)!;
  const byKey = new Map(LINKS.map((l) => [`${l.node_a}#${l.node_b}`, l.base_fidelity]));
  let product = 1;
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i]!;
    const b = r.path[i + 1]!;
    const f = byKey.get(`${a}#${b}`) ?? byKey.get(`${b}#${a}`)!;
    product *= f;
  }
  assert.ok(Math.abs(product - r.end_to_end_fidelity) < 1e-3);
});

check("returns null when min_fidelity is unreachable", () => {
  const r = findBestRoute(fullEdges, "nyc", "dc", 0.99);
  assert.equal(r, null);
});

check("returns null when a required link has no inventory", () => {
  // Drop all inventory on philly–baltimore: NYC→DC becomes impossible.
  const broken = fullEdges.map((e) =>
    (e.from === "philly" && e.to === "baltimore") ||
    (e.from === "baltimore" && e.to === "philly")
      ? { ...e, available_count: 0 }
      : e,
  );
  assert.equal(findBestRoute(broken, "nyc", "dc", 0.5), null);
});

check("direct neighbors route in a single hop", () => {
  const r = findBestRoute(fullEdges, "bnl", "sbu", 0.5)!;
  assert.deepEqual(r.path, ["bnl", "sbu"]);
  assert.equal(r.hops, 1);
});

check("respects the hop cap", () => {
  const r = findBestRoute(fullEdges, "boston", "dc", 0.0001, 2);
  // Boston→DC needs far more than 2 hops, so a cap of 2 finds nothing.
  assert.equal(r, null);
  assert.ok(MAX_HOPS >= 6);
});

console.log(`\n${passed} routing checks passed.`);
