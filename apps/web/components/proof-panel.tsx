"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import type { ProofResponse } from "@entangle/shared";

export function ProofPanel() {
  const [attempts, setAttempts] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProofResponse | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempts }),
      });
      setResult((await res.json()) as ProofResponse);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden />
        No-cloning proof
      </h2>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        A Bell pair can&apos;t be copied. Fire many concurrent claims at one pair —
        exactly one wins, enforced by a DynamoDB conditional write.
      </p>

      <label className="mt-3 block text-xs font-medium text-muted">
        Concurrent attempts: <span className="text-foreground">{attempts}</span>
        <input
          type="range"
          min={2}
          max={50}
          step={1}
          value={attempts}
          onChange={(e) => setAttempts(Number(e.target.value))}
          className="mt-1 w-full accent-accent"
        />
      </label>

      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? "Contending…" : "Run the proof"}
      </button>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"
        >
          <div className="text-center text-2xl font-bold text-emerald-700">
            {result.succeeded} <span className="text-base font-medium text-emerald-600">of</span>{" "}
            {result.attempts}
          </div>
          <div className="text-center text-[11px] font-medium text-emerald-700">
            reservation{result.succeeded === 1 ? "" : "s"} succeeded
          </div>
          <p className="mt-2 text-center text-[11px] font-semibold leading-snug text-emerald-800">
            {result.attempts} concurrent claims, exactly {result.succeeded} succeeded — uniqueness
            enforced by a DynamoDB conditional write.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{result.explanation}</p>
        </motion.div>
      )}
    </div>
  );
}
