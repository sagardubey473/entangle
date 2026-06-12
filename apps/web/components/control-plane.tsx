"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, ChevronDown } from "lucide-react";
import { MapPanel } from "@/components/map-panel";
import { RequestForm } from "@/components/request-form";
import { RequestFeed } from "@/components/request-feed";
import { ControlsPanel } from "@/components/controls-panel";
import { ProofPanel } from "@/components/proof-panel";
import { StatTiles } from "@/components/stat-tiles";
import { Dashboards } from "@/components/dashboards";
import { EventTimeline } from "@/components/event-timeline";
import { useEntangleState } from "@/lib/use-entangle-state";
import { deriveSeries, headline } from "@/lib/derive";

export function ControlPlane() {
  const { state, source } = useEntangleState();
  const [showTelemetry, setShowTelemetry] = useState(false);

  // Expanded by default on lg+, collapsed by default on mobile.
  useEffect(() => {
    setShowTelemetry(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  const series = useMemo(() => deriveSeries(state?.metrics ?? []), [state?.metrics]);
  const h = useMemo(() => headline(state?.metrics ?? [], series), [state?.metrics, series]);

  return (
    <div className="flex flex-col gap-6">
      {/* Map (dominant) + narrow action rail. The map stretches to the rail height. */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <MapPanel source={source} events={state?.recentEvents ?? []} />

        <aside className="flex flex-col gap-4 lg:max-w-sm">
          <RequestForm />
          <RequestFeed requests={state?.activeRequests ?? []} />
          <ProofPanel />
        </aside>
      </div>

      {/* Headline stats — always visible, plain language. */}
      <StatTiles h={h} />

      {/* Telemetry & controls — open on desktop, collapsible everywhere. */}
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => setShowTelemetry((v) => !v)}
          className="flex items-center justify-center gap-2 self-center rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground shadow-card transition hover:bg-background"
        >
          <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
          {showTelemetry ? "Hide telemetry & simulation controls" : "Telemetry & simulation controls"}
          <ChevronDown
            className={`h-4 w-4 text-muted transition-transform ${showTelemetry ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        <AnimatePresence initial={false}>
          {showTelemetry && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-w-0 flex-col gap-6">
                  <Dashboards series={series} />
                  <EventTimeline events={state?.recentEvents ?? []} />
                </div>
                <ControlsPanel controls={state?.controls ?? null} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
