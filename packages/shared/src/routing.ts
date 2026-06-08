/**
 * End-to-end routing across the live network.
 *
 * Long-distance quantum connections are built by entanglement swapping along a
 * chain of repeaters: end-to-end fidelity is the PRODUCT of the per-hop
 * fidelities. Finding the best route is therefore a "maximum-product path"
 * problem over the engine-maintained `live_links` routing summary.
 *
 * We express it as a recursive CTE in Aurora PostgreSQL so the database does the
 * graph walk close to the data. The query:
 *   - starts every walk at :src,
 *   - only traverses links that currently have inventory (available_count > 0)
 *     and whose current fidelity keeps the running product above :min_fidelity,
 *   - forbids revisiting a node (no cycles),
 *   - caps the walk at MAX_HOPS,
 *   - returns the single path to :dst with the highest end-to-end fidelity.
 *
 * Parameters (RDS Data API named params): :src, :dst, :min_fidelity, :max_hops
 */

/** Hard cap on hop count for any route. */
export const MAX_HOPS = 6;

export const ROUTE_QUERY_SQL = /* sql */ `
WITH RECURSIVE route AS (
  -- Base case: every directly-available link leaving the source node.
  SELECT
    l.from_node                          AS origin,
    l.to_node                            AS frontier,
    ARRAY[l.from_node, l.to_node]        AS path,
    l.current_fidelity                   AS product_fidelity,
    1                                    AS hops
  FROM live_links l
  WHERE l.from_node = :src
    AND l.available_count > 0
    AND l.current_fidelity >= :min_fidelity

  UNION ALL

  -- Recursive step: extend each partial path by one available hop, multiplying
  -- fidelities and pruning any branch that drops below the requested minimum.
  SELECT
    r.origin,
    l.to_node,
    r.path || l.to_node,
    r.product_fidelity * l.current_fidelity,
    r.hops + 1
  FROM route r
  JOIN live_links l ON l.from_node = r.frontier
  WHERE r.hops < :max_hops
    AND NOT (l.to_node = ANY(r.path))            -- no cycles
    AND l.available_count > 0
    AND (r.product_fidelity * l.current_fidelity) >= :min_fidelity
)
SELECT
  path,
  product_fidelity AS end_to_end_fidelity,
  hops
FROM route
WHERE frontier = :dst
ORDER BY product_fidelity DESC, hops ASC
LIMIT 1;
`;

/** A decoded result row from {@link ROUTE_QUERY_SQL}. */
export interface RouteResult {
  path: string[];
  end_to_end_fidelity: number;
  hops: number;
}

/** Minimal edge shape for in-memory routing (matches LiveLinkView). */
export interface RoutableEdge {
  from: string;
  to: string;
  fidelity: number;
  available_count?: number;
}

/**
 * Pure, in-memory equivalent of {@link ROUTE_QUERY_SQL}: the maximum-product
 * fidelity path from src to dst. Used by the demo simulator (which has no
 * Aurora) and unit-tested so it stays in lockstep with the SQL semantics. The
 * real engine uses the recursive CTE against live_links, per the spec.
 *
 * Treats edges as undirected, ignores edges without usable inventory, prunes any
 * branch whose running product drops below minFidelity, forbids cycles, and caps
 * the hop count. Returns the best route or null if none qualifies.
 */
export function findBestRoute(
  edges: RoutableEdge[],
  src: string,
  dst: string,
  minFidelity: number,
  maxHops: number = MAX_HOPS,
): RouteResult | null {
  // Build an undirected adjacency list from edges that have usable inventory.
  const adj = new Map<string, Array<{ to: string; fidelity: number }>>();
  const add = (a: string, b: string, f: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, fidelity: f });
  };
  for (const e of edges) {
    if (e.fidelity <= 0) continue;
    if (e.available_count !== undefined && e.available_count <= 0) continue;
    add(e.from, e.to, e.fidelity);
    add(e.to, e.from, e.fidelity);
  }

  let best: RouteResult | null = null;
  const visited = new Set<string>([src]);

  const dfs = (node: string, path: string[], product: number) => {
    if (product < minFidelity) return; // monotonic prune
    if (node === dst) {
      if (!best || product > best.end_to_end_fidelity) {
        best = { path: [...path], end_to_end_fidelity: product, hops: path.length - 1 };
      }
      return;
    }
    if (path.length - 1 >= maxHops) return;
    for (const { to, fidelity } of adj.get(node) ?? []) {
      if (visited.has(to)) continue;
      visited.add(to);
      dfs(to, [...path, to], product * fidelity);
      visited.delete(to);
    }
  };

  if (src !== dst) dfs(src, [src], 1);
  if (best) {
    const b = best as RouteResult;
    return { ...b, end_to_end_fidelity: Number(b.end_to_end_fidelity.toFixed(4)) };
  }
  return null;
}
