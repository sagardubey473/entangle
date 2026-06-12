"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { NetworkEvent } from "@entangle/shared";
import { nodeLabel } from "@/lib/nodes";
import { narrate, type Narration } from "@/lib/narrate";

const TONE_CLASS: Record<Narration["tone"], string> = {
  info: "text-foreground/80",
  success: "text-emerald-600 font-semibold",
  danger: "text-red-600 font-semibold",
};

interface TickerLine extends Narration {
  id: string;
  ts: number;
}

function clock(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

/**
 * One-line plain-English caption strip that narrates the live event stream.
 * Shows the newest meaningful event, with the previous one ghosted above.
 */
export function NarrationTicker({
  events,
  reducedMotion = false,
}: {
  events: NetworkEvent[];
  reducedMotion?: boolean;
}) {
  const [current, setCurrent] = useState<TickerLine | null>(null);
  const [previous, setPrevious] = useState<TickerLine | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    // events are newest-first; find the latest one worth narrating.
    for (const e of events) {
      const n = narrate(e, nodeLabel);
      if (!n) continue;
      if (e.event_id === lastId.current) break; // already showing the newest
      lastId.current = e.event_id;
      setCurrent((prevCurrent) => {
        if (prevCurrent) setPrevious(prevCurrent);
        return { ...n, id: e.event_id, ts: e.ts };
      });
      break;
    }
  }, [events]);

  return (
    <div className="flex min-h-[2.75rem] flex-col justify-center gap-0.5 border-t border-border bg-surface px-4 py-2">
      {previous && (
        <div className="truncate text-[11px] text-muted opacity-40">
          <span className="mr-2 font-mono">{clock(previous.ts)}</span>
          {previous.text}
        </div>
      )}
      <div className="relative h-5 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current?.id ?? "empty"}
            initial={reducedMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={{ duration: reducedMotion ? 0 : 0.35, ease: "easeOut" }}
            className="absolute inset-0 flex items-center truncate text-xs"
          >
            {current ? (
              <span className={`truncate ${TONE_CLASS[current.tone]}`}>
                <span className="mr-2 font-mono text-muted">{clock(current.ts)}</span>
                {current.text}
              </span>
            ) : (
              <span className="text-muted">Watching the network…</span>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
