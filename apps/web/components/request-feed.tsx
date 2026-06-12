"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";
import type { ConnectionRequest } from "@entangle/shared";
import { nodeLabel } from "@/lib/nodes";

const STATUS_STYLES: Record<ConnectionRequest["status"], string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  FULFILLED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

export function RequestFeed({ requests }: { requests: ConnectionRequest[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Requests</h2>
        <span className="text-xs text-muted">{requests.length} recent</span>
      </div>

      <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {requests.length === 0 && (
          <p className="py-6 text-center text-xs text-muted">
            No requests yet. Create one to route an end-to-end connection.
          </p>
        )}
        <AnimatePresence initial={false}>
          {requests.map((r) => (
            <motion.div
              key={r.request_id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border border-border bg-background/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                  <span className="truncate">{nodeLabel(r.src_node)}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{nodeLabel(r.dst_node)}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[r.status]}`}
                >
                  {r.status}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>needed ≥ {r.min_fidelity.toFixed(2)}</span>
                {r.status === "FULFILLED" && r.delivered_fidelity != null && (
                  <span className="text-emerald-600">
                    delivered {r.delivered_fidelity.toFixed(2)}
                    {r.path ? ` · ${r.path.length - 1} hop${r.path.length - 1 === 1 ? "" : "s"}` : ""}
                  </span>
                )}
                {r.status === "FAILED" && (
                  <span className="text-red-600">no route met the fidelity floor</span>
                )}
                {r.status === "PENDING" && <span className="text-amber-600">routing…</span>}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden />
                  {ago(r.created_at)}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
