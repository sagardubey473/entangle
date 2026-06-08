/** Engine configuration: load .env and expose tunable defaults + cadences. */

import "dotenv/config";
import { DEFAULT_SIM_CONTROLS, type SimControls } from "@entangle/shared";

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Initial controls (the live values are read from Aurora each refresh). */
export const initialControls: SimControls = {
  ticks_per_sec: numEnv("ENGINE_TICKS_PER_SEC", DEFAULT_SIM_CONTROLS.ticks_per_sec),
  gen_multiplier: numEnv("ENGINE_GEN_MULTIPLIER", DEFAULT_SIM_CONTROLS.gen_multiplier),
  decoherence_multiplier: numEnv(
    "ENGINE_DECOHERENCE_MULTIPLIER",
    DEFAULT_SIM_CONTROLS.decoherence_multiplier,
  ),
  fidelity_floor: numEnv("ENGINE_FIDELITY_FLOOR", DEFAULT_SIM_CONTROLS.fidelity_floor),
  paused: false,
};

/** How often (ms of real time) the engine flushes batched side-effects. */
export const cadences = {
  /** Flush queued events to Aurora. */
  events: 300,
  /** Recompute + flush the live_links routing summary. */
  liveLinks: 300,
  /** Write a metrics snapshot. */
  metrics: 1000,
  /** Re-read controls from Aurora (picks up UI changes). */
  controls: 1000,
};

/** Clamp a single tick's dt so a paused/suspended process can't mint a flood. */
export const MAX_TICK_DT_MS = 500;
