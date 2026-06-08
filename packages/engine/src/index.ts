/**
 * Entangle simulation engine — entry point.
 *
 * Phase 0: scaffold only. This prints the loaded canonical topology to prove the
 * shared package wires up. The fixed-timestep tick loop (generate / decay /
 * expire / route / snapshot) is implemented in Phase 2 onward.
 */

import { LINKS, NODES } from "@entangle/shared";

function main(): void {
  console.log("Entangle engine — scaffold (Phase 0)");
  console.log(`Loaded ${NODES.length} nodes, ${LINKS.length} physical links.\n`);
  console.table(
    LINKS.map((l) => ({
      link: l.link_id,
      km: l.distance_km,
      base_fidelity: l.base_fidelity,
      gen_rate: l.gen_rate,
      decoherence_rate: l.decoherence_rate,
    })),
  );
  console.log("\nTick loop arrives in Phase 2.");
}

main();
