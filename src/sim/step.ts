import { updatePhase } from './phases';
import { cloneState } from './state';
import type { GameState, InputSnapshot } from './types';

/**
 * Advance the game by exactly one fixed tick.
 *
 * Pure: no DOM, no timers, no randomness beyond the seeded PRNG in the state.
 * The same `(state, input)` always produces the same result, which is what
 * makes replay tests — and, later, server-side score validation — possible
 * (architecture §1, §8.3).
 *
 * All the behaviour lives in the phase machine in `phases.ts`; this is the
 * boundary that turns its in-place mutation into a value. Holding the returned
 * state next to the previous one is what the renderer interpolates between
 * (architecture §2.4).
 */
export function step(state: GameState, input: InputSnapshot, stepMs: number): GameState {
  const next = cloneState(state);
  updatePhase(next, input, stepMs);
  return next;
}
