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
