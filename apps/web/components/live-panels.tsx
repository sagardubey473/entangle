"use client";

import { useEntangleState } from "@/lib/use-entangle-state";
import { RequestFeed } from "@/components/request-feed";

/**
 * Client wrapper that polls shared state and feeds the live dashboard panels.
 * Phase 4: the request feed. Phase 5 adds dashboards, the event timeline, and
 * the no-cloning proof here.
 */
export function LivePanels() {
  const { state, source } = useEntangleState();

  return (
    <div className="flex flex-col gap-4">
      {source && (
        <div className="flex items-center justify-end">
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[11px] font-medium text-muted shadow-card">
            data source: <span className="text-foreground">{source}</span>
          </span>
        </div>
      )}
      <RequestFeed requests={state?.activeRequests ?? []} />
    </div>
  );
}
