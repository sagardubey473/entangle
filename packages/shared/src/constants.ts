/** Shared constants for table/index names and engine defaults. */

import type { SimControls } from "./types.js";

/** DynamoDB Global Secondary Index names. */
export const GSI1_ENDPOINTS = "GSI1_endpoints";
export const GSI2_STATUS = "GSI2_status";

/** Default request deadline if the caller doesn't specify one (ms of virtual time). */
export const DEFAULT_DEADLINE_MS = 8000;

/** Default runtime-tunable simulation controls. */
export const DEFAULT_SIM_CONTROLS: SimControls = {
  ticks_per_sec: 10,
  gen_multiplier: 1.0,
  decoherence_multiplier: 1.0,
  fidelity_floor: 0.5,
  paused: false,
};

/** Singleton key for the controls record (single control row/item). */
export const CONTROLS_KEY = "controls";
