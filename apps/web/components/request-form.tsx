"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { NODE_OPTIONS } from "@/lib/nodes";

export function RequestForm() {
  const [src, setSrc] = useState("nyc");
  const [dst, setDst] = useState("dc");
  const [minFidelity, setMinFidelity] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(s: string, d: string, mf: number) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src: s, dst: d, min_fidelity: mf }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setMsg({ kind: "ok", text: "Request queued — routing across the corridor." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-foreground">Create a connection</h2>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setSrc("nyc");
          setDst("dc");
          setMinFidelity(0.5);
          void submit("nyc", "dc", 0.5);
        }}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        New York City → Washington DC
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        The preset: there is no direct NYC–DC link, so this forces multi-hop
        routing through the repeater chain.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-muted">
          From
          <select
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {NODE_OPTIONS.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-muted">
          To
          <select
            value={dst}
            onChange={(e) => setDst(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {NODE_OPTIONS.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-muted">
        Minimum fidelity: <span className="text-foreground">{minFidelity.toFixed(2)}</span>
        <input
          type="range"
          min={0.5}
          max={0.95}
          step={0.01}
          value={minFidelity}
          onChange={(e) => setMinFidelity(Number(e.target.value))}
          className="mt-1 w-full accent-accent"
        />
      </label>

      <button
        type="button"
        disabled={busy || src === dst}
        onClick={() => void submit(src, dst, minFidelity)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-background disabled:opacity-60"
      >
        <Send className="h-4 w-4" aria-hidden />
        {src === dst ? "Pick two different nodes" : "Send request"}
      </button>

      {msg && (
        <p
          className={`mt-2 text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
