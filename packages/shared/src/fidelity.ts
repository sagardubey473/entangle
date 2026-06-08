/**
 * Fidelity math — the physically-motivated model of decoherence shared by the
 * engine and the web app. There is no duplicate copy of this math anywhere else.
 *
 * Physical grounding:
 *  - An entangled (Bell) pair has a quality measure "fidelity" in [0, 1].
 *  - It decays continuously (decoherence): F(t) = F0 * exp(-k * dt).
 *  - We treat a pair as unusable once its fidelity drops below a FLOOR.
 *  - End-to-end fidelity of a multi-hop path ≈ the product of per-hop fidelities
 *    (entanglement swapping multiplies the qualities of the segments it stitches).
 *
 * We never store a mutating "current fidelity". We store initial_fidelity,
 * decay_rate and created_at, and COMPUTE the current value on demand.
 */

/** Default fidelity floor below which a pair is considered expired/unusable. */
export const DEFAULT_FIDELITY_FLOOR = 0.5;

/**
 * Current fidelity of a pair at time `now`, given its creation parameters.
 * @param initial    fidelity at creation (0..1)
 * @param decayRate  per-millisecond decay rate (>= 0)
 * @param createdAt  epoch milliseconds at creation
 * @param now        epoch milliseconds to evaluate at
 */
export function currentFidelity(
  initial: number,
  decayRate: number,
  createdAt: number,
  now: number,
): number {
  const dt = Math.max(0, now - createdAt);
  const f = initial * Math.exp(-decayRate * dt);
  // Clamp into [0, 1] to guard against numerical noise.
  return Math.max(0, Math.min(1, f));
}

/** True when a pair's current fidelity has dropped below the floor. */
export function isExpired(
  initial: number,
  decayRate: number,
  createdAt: number,
  now: number,
  floor: number = DEFAULT_FIDELITY_FLOOR,
): boolean {
  return currentFidelity(initial, decayRate, createdAt, now) < floor;
}

/**
 * The epoch-millisecond timestamp at which a pair's fidelity will reach `floor`.
 * Solve initial * exp(-decayRate * dt) = floor  =>  dt = ln(initial/floor)/decayRate.
 * Returns createdAt itself if the pair is already at/below the floor, and
 * Infinity if it can never decay (decayRate <= 0).
 */
export function expiryTimeMs(
  initial: number,
  decayRate: number,
  createdAt: number,
  floor: number = DEFAULT_FIDELITY_FLOOR,
): number {
  if (initial <= floor) return createdAt;
  if (decayRate <= 0) return Infinity;
  const dt = Math.log(initial / floor) / decayRate;
  return createdAt + dt;
}

/**
 * The DynamoDB TTL value (epoch SECONDS) at which the pair should auto-delete:
 * the moment it hits the floor. DynamoDB TTL operates on Unix seconds.
 */
export function expiresAtSeconds(
  initial: number,
  decayRate: number,
  createdAt: number,
  floor: number = DEFAULT_FIDELITY_FLOOR,
): number {
  const ms = expiryTimeMs(initial, decayRate, createdAt, floor);
  if (!Number.isFinite(ms)) {
    // Pair effectively never decays — set TTL far in the future (~1 year).
    return Math.ceil((createdAt + 365 * 24 * 60 * 60 * 1000) / 1000);
  }
  return Math.ceil(ms / 1000);
}

/**
 * End-to-end fidelity of a path: the product of the per-hop current fidelities.
 * An empty list yields 0 (no path = no connection).
 */
export function pathFidelity(hopFidelities: number[]): number {
  if (hopFidelities.length === 0) return 0;
  return hopFidelities.reduce((acc, f) => acc * Math.max(0, Math.min(1, f)), 1);
}

/**
 * Map a fidelity value (0..1) to the RGB color of the light-theme fidelity
 * scale: red (low) -> amber (mid) -> emerald (high). Kept here so the engine,
 * tests and UI agree on the exact interpolation.
 */
export function fidelityColor(f: number): string {
  const v = Math.max(0, Math.min(1, f));
  const stops: Array<{ t: number; c: [number, number, number] }> = [
    { t: 0.0, c: [239, 68, 68] }, // #EF4444 red
    { t: 0.5, c: [245, 158, 11] }, // #F59E0B amber
    { t: 1.0, c: [16, 185, 129] }, // #10B981 emerald
  ];
  let a = stops[0]!;
  let b = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (v >= lo.t && v <= hi.t) {
      a = lo;
      b = hi;
      break;
    }
  }
  const k = (v - a.t) / (b.t - a.t || 1);
  const ch = (i: number) => Math.round(a.c[i]! + (b.c[i]! - a.c[i]!) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}
