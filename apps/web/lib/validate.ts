/** Tiny request-body validators shared by the write API routes. */

import { NODES } from "@entangle/shared";

const NODE_IDS = new Set(NODES.map((n) => n.node_id));

export interface ParsedRequest {
  src: string;
  dst: string;
  min_fidelity: number;
  deadline_ms?: number;
}

export function parseCreateRequest(body: unknown): ParsedRequest | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Body must be an object." };
  const b = body as Record<string, unknown>;

  const src = b.src;
  const dst = b.dst;
  if (typeof src !== "string" || !NODE_IDS.has(src)) return { error: `Unknown src node: ${String(src)}` };
  if (typeof dst !== "string" || !NODE_IDS.has(dst)) return { error: `Unknown dst node: ${String(dst)}` };
  if (src === dst) return { error: "src and dst must differ." };

  const min = b.min_fidelity;
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0 || min >= 1) {
    return { error: "min_fidelity must be a number in (0, 1)." };
  }

  const result: ParsedRequest = { src, dst, min_fidelity: min };
  if (b.deadline_ms !== undefined) {
    const d = b.deadline_ms;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) {
      return { error: "deadline_ms must be a positive number." };
    }
    result.deadline_ms = d;
  }
  return result;
}
