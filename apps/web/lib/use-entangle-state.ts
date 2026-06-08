"use client";

import { useEffect, useRef, useState } from "react";
import type { StateResponse } from "@entangle/shared";

/**
 * Polls /api/state on an interval and returns the latest snapshot. Shared by the
 * dashboard panels so they stay in sync. The map polls independently (it ships
 * with its own fallback), so a brief divergence is harmless.
 */
export function useEntangleState(intervalMs = 400): {
  state: StateResponse | null;
  source: string | null;
} {
  const [state, setState] = useState<StateResponse | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!alive.current) return;
        setSource(res.headers.get("X-Entangle-Source"));
        const data = (await res.json()) as StateResponse;
        if (alive.current) setState(data);
      } catch {
        /* keep last good state */
      }
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { state, source };
}
