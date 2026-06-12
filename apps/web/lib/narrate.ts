/**
 * Translates raw network events into plain-English sentences a non-expert can
 * follow. Returns null for events too noisy/low-signal for the ticker (they
 * still appear in the full event ledger).
 */

import type { NetworkEvent } from "@entangle/shared";

function linkLabel(linkId: unknown, nodeLabel: (id: string) => string): string {
  if (typeof linkId !== "string") return "a link";
  const [a, b] = linkId.split("--");
  return a && b ? `${nodeLabel(a)}–${nodeLabel(b)}` : linkId;
}

export type NarrationTone = "info" | "success" | "danger";

export interface Narration {
  text: string;
  tone: NarrationTone;
}

export function narrate(
  e: NetworkEvent,
  nodeLabel: (id: string) => string,
): Narration | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case "GENERATED":
      return {
        tone: "info",
        text: `New entangled pair on ${linkLabel(p.link_id, nodeLabel)} (F=${Number(
          p.fidelity ?? 0,
        ).toFixed(2)})`,
      };
    case "SWAPPED":
      return {
        tone: "info",
        text: `Swap at ${nodeLabel(String(p.at ?? ""))}: two short links fused into one longer entangled link`,
      };
    case "FULFILLED": {
      const path = Array.isArray(p.path) ? (p.path as string[]) : [];
      const src = path[0] ? nodeLabel(path[0]) : "source";
      const dst = path[path.length - 1] ? nodeLabel(path[path.length - 1]!) : "destination";
      const hops = typeof p.hops === "number" ? p.hops : Math.max(1, path.length - 1);
      return {
        tone: "success",
        text: `✓ ${src} → ${dst} connected in ${hops} hop${hops === 1 ? "" : "s"}, delivered F=${Number(
          p.delivered_fidelity ?? 0,
        ).toFixed(2)}`,
      };
    }
    case "EXPIRED":
      return {
        tone: "info",
        text: p.injected
          ? `Pair on ${linkLabel(p.link_id, nodeLabel)} dropped by link failure`
          : `Pair on ${linkLabel(p.link_id, nodeLabel)} decohered and expired`,
      };
    case "LINK_FAILURE":
      return {
        tone: "danger",
        text: `⚠ Link ${linkLabel(p.link_id, nodeLabel)} failed — rerouting around it`,
      };
    case "FAILED":
      return {
        tone: "danger",
        text: `✗ Request failed — no route met the fidelity floor in time`,
      };
    default:
      return null; // RESERVED / CONSUMED / CONTROL: too noisy for the ticker
  }
}
