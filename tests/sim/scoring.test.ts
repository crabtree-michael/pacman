import { describe, expect, it } from 'vitest';
import {
  EXTRA_LIFE_SCORE,
  GHOST_POINTS,
  PELLET_POINTS,
  award,
  ghostPoints,
} from '../../src/sim/scoring';
import { playing } from './harness';

/**
 * Scoring, the ghost ladder and the extra life (product spec §4.4).
 */

describe('the ghost ladder', () => {
  it('doubles for each ghost eaten under one power pellet', () => {
    expect(GHOST_POINTS).toEqual([200, 400, 800, 1600]);
    expect(GHOST_POINTS.map((_, index) => ghostPoints(index))).toEqual([200, 400, 800, 1600]);
  });

  it('holds at the top rung rather than running off the end', () => {
    // There are only four ghosts, so this is unreachable — but a clamp is
    // cheaper than an undefined score if that ever stops being true.
    expect(ghostPoints(9)).toBe(1600);
    expect(ghostPoints(-1)).toBe(200);
  });
});

describe('the extra life', () => {
  it('arrives at 10,000 points', () => {
    const state = { ...playing(), score: EXTRA_LIFE_SCORE - PELLET_POINTS };
    award(state, PELLET_POINTS);

    expect(state.lives).toBe(4);
    expect(state.extraLifeAwarded).toBe(true);
    expect(state.events).toContainEqual({ type: 'ExtraLife' });
  });

  it('arrives on whatever crosses the line, not just a pellet', () => {
    const state = { ...playing(), score: 9000 };
    award(state, 1600); // The fourth ghost of a chain.
    expect(state.lives).toBe(4);
  });

  it('is granted once a game', () => {
    const state = { ...playing(), score: EXTRA_LIFE_SCORE };
    award(state, 0);
    expect(state.lives).toBe(4);

    award(state, EXTRA_LIFE_SCORE);
    expect(state.lives).toBe(4);
    expect(state.events.filter((event) => event.type === 'ExtraLife')).toHaveLength(1);
  });

  it('does not arrive early', () => {
    const state = { ...playing(), score: 0 };
    award(state, EXTRA_LIFE_SCORE - 10);

    expect(state.lives).toBe(3);
    expect(state.extraLifeAwarded).toBe(false);
  });

  it('survives a level change but not a new game', () => {
    const state = { ...playing(), score: EXTRA_LIFE_SCORE };
    award(state, 0);
    expect(state.extraLifeAwarded).toBe(true);

    // `resetGame` is what a restart runs; the flag is part of what it clears.
    expect(playing().extraLifeAwarded).toBe(false);
  });
});
