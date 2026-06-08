import { NODES } from "@entangle/shared";

/** Short display labels for node ids, used across the dashboard panels. */
export const NODE_LABEL: Record<string, string> = {
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

export function nodeLabel(id: string): string {
  return NODE_LABEL[id] ?? id;
}

/** Endpoint and repeater node ids (for select menus), in topology order. */
export const NODE_OPTIONS = NODES.map((n) => ({
  id: n.node_id,
  label: nodeLabel(n.node_id),
  kind: n.kind,
}));
