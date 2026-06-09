"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Sliders, ZapOff } from "lucide-react";
import { LINKS, type SimControls } from "@entangle/shared";
import { nodeLabel } from "@/lib/nodes";

const LINK_OPTIONS = LINKS.map((l) => ({
  id: l.link_id,
  label: `${nodeLabel(l.node_a)} – ${nodeLabel(l.node_b)}`,
}));

async function postControl(body: Record<string, unknown>) {
  await fetch("/api/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function ControlsPanel({ controls }: { controls: SimControls | null }) {
  const [gen, setGen] = useState(1);
  const [dec, setDec] = useState(1);
  const [linkId, setLinkId] = useState(LINK_OPTIONS[0]?.id ?? "");
  const [injected, setInjected] = useState(false);
  const synced = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize sliders from server controls once.
  useEffect(() => {
    if (!synced.current && controls) {
      setGen(controls.gen_multiplier);
      setDec(controls.decoherence_multiplier);
      synced.current = true;
    }
  }, [controls]);

  const paused = controls?.paused ?? false;

  function debouncedPost(body: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void postControl(body), 150);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sliders className="h-4 w-4 text-accent" aria-hidden />
        Simulation controls
      </h2>

      <label className="mt-4 block text-xs font-medium text-muted">
        Generation rate ×<span className="text-foreground"> {gen.toFixed(1)}</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.1}
          value={gen}
          onChange={(e) => {
            const v = Number(e.target.value);
            setGen(v);
            debouncedPost({ gen_multiplier: v });
          }}
          className="mt-1 w-full accent-accent"
        />
      </label>

      <label className="mt-3 block text-xs font-medium text-muted">
        Decoherence rate ×<span className="text-foreground"> {dec.toFixed(1)}</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.1}
          value={dec}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDec(v);
            debouncedPost({ decoherence_multiplier: v });
          }}
          className="mt-1 w-full accent-accent"
        />
      </label>

      <button
        type="button"
        onClick={() => void postControl({ paused: !paused })}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-background"
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        {paused ? "Resume simulation" : "Pause simulation"}
      </button>

      <div className="mt-4 border-t border-border pt-4">
        <div className="text-xs font-medium text-muted">Inject link failure</div>
        <div className="mt-1.5 flex gap-2">
          <select
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {LINK_OPTIONS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void postControl({ inject_failure_link_id: linkId });
              setInjected(true);
              setTimeout(() => setInjected(false), 1500);
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-600"
          >
            <ZapOff className="h-3.5 w-3.5" />
            Fail
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {injected
            ? "Failure injected — watch active routes reroute around it."
            : "Expires every pair on the link, forcing routes to find another path."}
        </p>
      </div>
    </div>
  );
}
