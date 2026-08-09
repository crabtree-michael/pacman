/**
 * Seeded xorshift32.
 *
 * The simulation must be deterministic for replay tests and for the
 * server-side score validation the architecture keeps the door open to (§8.3),
 * so nothing in `sim/` may call `Math.random`. State is a single uint32, which
 * keeps `GameState` cheap to clone and serialise.
 */

export const DEFAULT_SEED = 0x9e3779b9;

/** Advance the state. Returns the new state; callers store it back. */
export function nextRng(state: number): number {
  let x = state | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

/** A value in [0, bound) derived from a state, without advancing it. */
export function rngBelow(state: number, bound: number): number {
  return (state >>> 0) % bound;
}
