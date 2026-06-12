"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle, X } from "lucide-react";
import type { NetworkEvent } from "@entangle/shared";
import { CorridorMapLive } from "@/components/corridor-map-live";
import { NarrationTicker } from "@/components/narration-ticker";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

function HelpPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="How to read this map"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted transition hover:bg-background hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        How to read this
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-8 z-20 w-64 rounded-xl border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted shadow-card"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">How to read this</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-3.5 w-3.5 text-muted hover:text-foreground" />
              </button>
            </div>
            <ul className="space-y-1.5">
              <li><span className="font-medium text-foreground">Arc</span> = a shared entangled link between two sites.</li>
              <li><span className="font-medium text-foreground">Color</span> = link quality (fidelity): green high → red low; arcs fade as they decay.</li>
              <li><span className="font-medium text-foreground">Swap</span> = a repeater fuses two short links into one longer link.</li>
              <li><span className="font-medium text-foreground">Bright pulse</span> = a connection request routed end-to-end.</li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-12 rounded-full bg-gradient-to-r from-fidelity-low via-fidelity-mid to-fidelity-high" />
        fidelity
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-node-endpoint ring-2 ring-accent/40" /> endpoint
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-node-repeater" /> repeater
      </span>
      <span className="hidden items-center gap-1 sm:flex">
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-accent bg-transparent" /> testbed core
      </span>
      <HelpPopover />
    </div>
  );
}

export function MapPanel({ source, events }: { source: string | null; events: NetworkEvent[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      {/* header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fidelity-high opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-fidelity-high" />
          </span>
          East Coast quantum corridor
          {source && (
            <span className="ml-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted">
              data source: <span className="text-foreground">{source}</span>
            </span>
          )}
        </div>
        <Legend />
      </div>

      {/* map fills available height */}
      <div className="relative min-h-0 flex-1 bg-[#F1F6FB]">
        <CorridorMapLive />
      </div>

      {/* live narration */}
      <NarrationTicker events={events} reducedMotion={reduced} />
    </div>
  );
}
