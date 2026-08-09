import { fruitForLevel } from './levels';
import { award } from './scoring';
import type { GameState } from './types';

/**
 * The bonus fruit (product spec §4.4).
 *
 * Architecture §3.4 does not name a module for it — the fruit is one paragraph
 * of the spec — but it is its own small clock and its own spawn rule, and
 * folding it into `pacman.ts` would put two unrelated timers in the player
 * update.
 */

/** Pellets eaten this level that summon the first and second fruit. */
export const FRUIT_DOT_THRESHOLDS: readonly number[] = [70, 170];

/** How long an uneaten fruit stays on the board. */
export const FRUIT_MS = 9500;

/**
 * Tick the fruit clock, then offer the next fruit if the board has earned it.
 *
 * Spawning after the tick rather than before is what gives a fruit its full
 * 9.5 s: the alternative charges it a tick for the frame it appeared on.
 */
export function updateFruit(state: GameState, stepMs: number): void {
  if (state.fruit) {
    state.fruit.msRemaining -= stepMs;
    // The same slack the phase clocks use: repeated float subtraction leaves a
    // sliver behind, and a `> 0` test would cost the fruit an extra tick.
    if (state.fruit.msRemaining <= stepMs / 1000) state.fruit = null;
  }

  const threshold = FRUIT_DOT_THRESHOLDS[state.fruitsShown];
  if (threshold === undefined || state.dotsEaten < threshold) return;

  const { kind, points } = fruitForLevel(state.level);
  const spawn = state.maze.data.spawns.fruit;
  state.fruitsShown++;
  state.fruit = { kind, points, col: spawn.x, row: spawn.y, msRemaining: FRUIT_MS };
  state.events.push({ type: 'FruitAppeared', kind });
}

/** Collect the fruit if Pac-Man is standing on it. */
export function takeFruit(state: GameState, col: number, row: number): void {
  const fruit = state.fruit;
  if (!fruit || fruit.col !== col || fruit.row !== row) return;

  state.fruit = null;
  award(state, fruit.points);
  state.events.push({ type: 'FruitEaten', kind: fruit.kind, points: fruit.points });
}
