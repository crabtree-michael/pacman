import type { GameState } from './types';

/**
 * Points, multipliers and the extra life (product spec §4.4).
 *
 * Every score change in the game goes through `award`, so the extra-life
 * threshold is checked in exactly one place. Scattering `score +=` around the
 * simulation is how the 10,000-point life ends up granted twice, or missed
 * when the crossing happens on a fruit rather than a pellet.
 */

export const PELLET_POINTS = 10;
export const POWER_PELLET_POINTS = 50;

/** 200 / 400 / 800 / 1600 for successive ghosts under one power pellet. */
export const GHOST_POINTS: readonly number[] = [200, 400, 800, 1600];

/** One extra life, once per game. */
export const EXTRA_LIFE_SCORE = 10_000;

/**
 * What the next ghost eaten is worth.
 *
 * `ghostsEaten` is the count *before* this one. There are only four ghosts, so
 * the ladder cannot legitimately run past its end; clamping rather than
 * throwing keeps a future bug cheap.
 */
export function ghostPoints(ghostsEaten: number): number {
  const index = Math.min(Math.max(0, ghostsEaten), GHOST_POINTS.length - 1);
  return GHOST_POINTS[index] as number;
}

/** Add points, granting the extra life if this is the crossing that earns it. */
export function award(state: GameState, points: number): void {
  state.score += points;
  if (state.extraLifeAwarded || state.score < EXTRA_LIFE_SCORE) return;

  state.extraLifeAwarded = true;
  state.lives++;
  state.events.push({ type: 'ExtraLife' });
}
