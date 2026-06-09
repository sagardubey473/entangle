"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, ChevronDown } from "lucide-react";
import { CorridorMapLive } from "@/components/corridor-map-live";
import { RequestForm } from "@/components/request-form";
import { RequestFeed } from "@/components/request-feed";
import { ControlsPanel } from "@/components/controls-panel";
import { ProofPanel } from "@/components/proof-panel";
import { StatTiles } from "@/components/stat-tiles";
import { Dashboards } from "@/components/dashboards";
import { EventTimeline } from "@/components/event-timeline";
import { useEntangleState } from "@/lib/use-entangle-state";
import { deriveSeries, headline } from "@/lib/derive";

function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-muted shadow-card">
      <span className="flex items-center gap-2">
        <span className="font-medium text-foreground">Link fidelity</span>
        <span className="h-2 w-20 rounded-full bg-gradient-to-r from-fidelity-low via-fidelity-mid to-fidelity-high" />
        <span>low → high</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-node-endpoint" /> Endpoint
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-node-repeater" /> Repeater
      </span>
      <span className="hidden sm:inline">Arcs fade as pairs decohere; a bright pulse traces a fulfilled route.</span>
    </div>
  );
}

export function ControlPlane() {
  const { state, source } = useEntangleState();
  const [showTelemetry, setShowTelemetry] = useState(false);

  const series = useMemo(() => deriveSeries(state?.metrics ?? []), [state?.metrics]);
  const h = useMemo(() => headline(state?.metrics ?? [], series), [state?.metrics, series]);

  return (
    <div className="flex flex-col gap-6">
      {/* Focused view: the map and the three story beats. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <CorridorMapLive />
          <MapLegend />
        </div>

        <aside className="flex flex-col gap-4">
          {source && (
            <div className="flex items-center justify-end">
              <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-card">
                data source: <span className="text-foreground">{source}</span>
              </span>
            </div>
          )}
          <RequestForm />
          <ProofPanel />
          <RequestFeed requests={state?.activeRequests ?? []} />
        </aside>
      </div>

      {/* Everything quantitative lives behind one toggle, collapsed by default. */}
      <div className="flex flex-col gap-6">
        <button
          type="button"
          onClick={() => setShowTelemetry((v) => !v)}
          className="flex items-center justify-center gap-2 self-center rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground shadow-card transition hover:bg-background"
        >
          <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
          {showTelemetry ? "Hide telemetry & controls" : "Show telemetry & controls"}
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
              <div className="flex flex-col gap-6">
                <StatTiles h={h} />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="flex min-w-0 flex-col gap-6">
                    <Dashboards series={series} />
                    <EventTimeline events={state?.recentEvents ?? []} />
                  </div>
                  <ControlsPanel controls={state?.controls ?? null} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
