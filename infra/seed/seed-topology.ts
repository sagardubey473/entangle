/**
 * Seed the Aurora `nodes` and `links` tables with the canonical East Coast
 * quantum corridor (imported from @entangle/shared — single source of truth),
 * and initialize the `live_links` routing summary with one zeroed row per
 * directed edge. Idempotent via upserts.
 *
 * Usage:  pnpm infra:seed
 */

import { NODES, LINKS } from "@entangle/shared";
import { exec, p } from "../db.js";

async function seedNodes(): Promise<void> {
  for (const n of NODES) {
    await exec(
      `INSERT INTO nodes (node_id, name, lat, lng, kind, tier, memory_slots)
       VALUES (:node_id, :name, :lat, :lng, :kind, :tier, :memory_slots)
       ON CONFLICT (node_id) DO UPDATE SET
         name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
         kind = EXCLUDED.kind, tier = EXCLUDED.tier,
         memory_slots = EXCLUDED.memory_slots`,
      [
        p("node_id", n.node_id),
        p("name", n.name),
        p("lat", n.lat),
        p("lng", n.lng),
        p("kind", n.kind),
        p("tier", n.tier),
        p("memory_slots", n.memory_slots),
      ],
    );
  }
  console.log(`  ✓ seeded ${NODES.length} nodes`);
}

async function seedLinks(): Promise<void> {
  for (const l of LINKS) {
    await exec(
      `INSERT INTO links (link_id, node_a, node_b, distance_km, base_fidelity, gen_rate, decoherence_rate)
       VALUES (:link_id, :node_a, :node_b, :distance_km, :base_fidelity, :gen_rate, :decoherence_rate)
       ON CONFLICT (link_id) DO UPDATE SET
         node_a = EXCLUDED.node_a, node_b = EXCLUDED.node_b,
         distance_km = EXCLUDED.distance_km, base_fidelity = EXCLUDED.base_fidelity,
         gen_rate = EXCLUDED.gen_rate, decoherence_rate = EXCLUDED.decoherence_rate`,
      [
        p("link_id", l.link_id),
        p("node_a", l.node_a),
        p("node_b", l.node_b),
        p("distance_km", l.distance_km),
        p("base_fidelity", l.base_fidelity),
        p("gen_rate", l.gen_rate),
        p("decoherence_rate", l.decoherence_rate),
      ],
    );
  }
  console.log(`  ✓ seeded ${LINKS.length} links`);
}

async function seedLiveLinks(): Promise<void> {
  // One directed row per direction of every physical edge, zeroed.
  let count = 0;
  for (const l of LINKS) {
    for (const [from, to] of [
      [l.node_a, l.node_b],
      [l.node_b, l.node_a],
    ] as const) {
      await exec(
        `INSERT INTO live_links (from_node, to_node, best_pair_id, current_fidelity, available_count, updated_at)
         VALUES (:from_node, :to_node, NULL, 0, 0, 0)
         ON CONFLICT (from_node, to_node) DO NOTHING`,
        [p("from_node", from), p("to_node", to)],
      );
      count++;
    }
  }
  console.log(`  ✓ initialized ${count} live_links rows`);
}

async function main(): Promise<void> {
  console.log("==> Seeding East Coast quantum corridor topology...");
  await seedNodes();
  await seedLinks();
  await seedLiveLinks();
  console.log("==> Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
