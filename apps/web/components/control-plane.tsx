"use client";

import { useMemo } from "react";
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

export function ControlPlane() {
  const { state, source } = useEntangleState();

  const series = useMemo(() => deriveSeries(state?.metrics ?? []), [state?.metrics]);
  const h = useMemo(() => headline(state?.metrics ?? [], series), [state?.metrics, series]);

  return (
    <div className="flex flex-col gap-6">
      <StatTiles h={h} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: map dominant, then dashboards + timeline */}
        <div className="flex min-w-0 flex-col gap-6">
          <CorridorMapLive />
          <Dashboards series={series} />
          <EventTimeline events={state?.recentEvents ?? []} />
        </div>

        {/* Right: controls + feed sidebar */}
        <aside className="flex flex-col gap-4">
          {source && (
            <div className="flex items-center justify-end">
              <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-card">
                data source: <span className="text-foreground">{source}</span>
              </span>
            </div>
          )}
          <RequestForm />
          <ControlsPanel controls={state?.controls ?? null} />
          <ProofPanel />
          <RequestFeed requests={state?.activeRequests ?? []} />
        </aside>
      </div>
    </div>
  );
}
