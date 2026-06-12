import { NODES } from "@entangle/shared";
import type { NetworkNode } from "@/components/ui/quantum-corridor-map";

/**
 * SINGLE SOURCE OF TRUTH for node display metadata, used by the map, the
 * narration ticker, the event ledger, and the request panels. Coordinates +
 * kind/tier come from @entangle/shared (the same topology the engine uses);
 * short labels and hand-tuned label offsets live here.
 *
 * `labelOffset` fans the dense Long Island / NYC testbed cluster apart so the
 * labels don't pile up. Offsets are dx/dy in SVG units (800×680 viewBox) from
 * the node to the center of its label chip; a leader line is drawn when the
 * offset is large enough.
 */

const SHORT_LABEL: Record<string, string> = {
  bnl: "Brookhaven",
  sbu: "Stony Brook",
  commack: "Commack",
  westbury: "Westbury",
  nyc: "New York City",
  columbia: "Columbia",
  yale: "Yale",
  hartford: "Hartford",
  boston: "Boston",
  princeton: "Princeton",
  philly: "Philadelphia",
  baltimore: "Baltimore",
  dc: "Washington DC",
};

// Hand-tuned label offsets for the crammed LI/NYC cluster (verified
// non-overlapping at the 800×680 viewBox). Nodes not listed use the default
// placement (centered above the node).
const LABEL_OFFSET: Record<string, { dx: number; dy: number }> = {
  columbia: { dx: -58, dy: -30 }, // fan up-left
  nyc: { dx: 52, dy: 26 }, //        down-right (clears Columbia above + Princeton below-left)
  sbu: { dx: 6, dy: -34 }, //        up
  bnl: { dx: 66, dy: 4 }, //         right
  yale: { dx: 0, dy: -26 }, //       up (already isolated, short leader)
};

export const NODE_LABEL: Record<string, string> = SHORT_LABEL;

export function nodeLabel(id: string): string {
  return SHORT_LABEL[id] ?? id;
}

/** Full display nodes for the map, with short labels + cluster label offsets. */
export const MAP_NODES: NetworkNode[] = NODES.map((n) => ({
  id: n.node_id,
  lat: n.lat,
  lng: n.lng,
  label: nodeLabel(n.node_id),
  kind: n.kind,
  tier: n.tier,
  ...(LABEL_OFFSET[n.node_id] ? { labelOffset: LABEL_OFFSET[n.node_id] } : {}),
}));

export const NODE_BY_ID: Record<string, NetworkNode> = Object.fromEntries(
  MAP_NODES.map((n) => [n.id, n]),
);

/** Endpoint and repeater node ids (for select menus), in topology order. */
export const NODE_OPTIONS = NODES.map((n) => ({
  id: n.node_id,
  label: nodeLabel(n.node_id),
  kind: n.kind,
}));
