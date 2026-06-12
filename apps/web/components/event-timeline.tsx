"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { EventType, NetworkEvent } from "@entangle/shared";
import { nodeLabel } from "@/lib/nodes";

const TYPE_BADGE: Record<EventType, string> = {
  GENERATED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  EXPIRED: "bg-red-50 text-red-600 border-red-200",
  RESERVED: "bg-indigo-50 text-accent border-indigo-200",
  CONSUMED: "bg-sky-50 text-sky-700 border-sky-200",
  SWAPPED: "bg-violet-50 text-violet-700 border-violet-200",
  FULFILLED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  LINK_FAILURE: "bg-red-50 text-red-700 border-red-200",
  CONTROL: "bg-gray-50 text-muted border-gray-200",
};

function linkLabel(linkId: unknown): string {
  if (typeof linkId !== "string") return "";
  const [a, b] = linkId.split("--");
  return a && b ? `${nodeLabel(a)}–${nodeLabel(b)}` : linkId;
}

function describe(e: NetworkEvent): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case "GENERATED":
      return `pair on ${linkLabel(p.link_id)} (F=${Number(p.fidelity ?? 0).toFixed(2)})`;
    case "EXPIRED":
      return `${p.injected ? "link-failure expiry" : "decohered"} on ${linkLabel(p.link_id)}`;
    case "RESERVED":
      return `reserved on ${linkLabel(p.link_id)}`;
    case "CONSUMED":
      return `consumed on ${linkLabel(p.link_id)}`;
    case "SWAPPED":
      return `swap at ${nodeLabel(String(p.at ?? ""))}`;
    case "FULFILLED":
      return `delivered F=${Number(p.delivered_fidelity ?? 0).toFixed(3)} · ${p.hops ?? "?"} hops`;
    case "FAILED":
      return `request failed (${String(p.reason ?? "no route")})`;
    case "LINK_FAILURE":
      return `injected failure on ${linkLabel(p.link_id)} (−${p.dropped ?? 0})`;
    default:
      return "";
  }
}

function ts(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0").slice(0, 2);
}

export function EventTimeline({ events }: { events: NetworkEvent[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-foreground">Event ledger</h2>
      <p className="mt-0.5 text-[11px] text-muted">Append-only — every generation, swap, and expiry.</p>
      <div className="mt-3 max-h-[300px] space-y-1 overflow-y-auto overflow-x-hidden pr-1 font-mono text-[11px] leading-relaxed">
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.div
              key={e.event_id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-baseline gap-2"
            >
              <span className="shrink-0 text-muted">{ts(e.ts)}</span>
              <span
                className={`shrink-0 rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide ${TYPE_BADGE[e.type]}`}
              >
                {e.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/80">{describe(e)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {events.length === 0 && (
          <p className="py-6 text-center font-sans text-xs text-muted">Waiting for events…</p>
        )}
      </div>
    </div>
  );
}
