import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { FRUIT_DOT_THRESHOLDS, FRUIT_MS } from '../../src/sim/fruit';
import { fruitForLevel } from '../../src/sim/levels';
import { isWall } from '../../src/sim/maze';
import { tileCentre, type GameState } from '../../src/sim/types';
import { advance, advanceUntil, playing } from './harness';

/**
 * The bonus fruit (product spec §4.4).
 *
 * Its two appearances are driven by the level's dot count, so these fast-
 * forward the counter rather than eating 170 pellets: the rule under test is
 * the threshold, and reaching it the slow way tests the pellet code twice.
 */

const [FIRST, SECOND] = FRUIT_DOT_THRESHOLDS as readonly [number, number];

/** A game with `dots` collectibles already eaten this level. */
function withDots(dots: number, level = 1): GameState {
  return { ...playing(level), dotsEaten: dots, level };
}

describe('the fruit tile', () => {
  it('is an open tile below the ghost house', () => {
    const { fruit } = MAZE_CLASSIC.spawns;
    expect(isWall(MAZE_CLASSIC, fruit.x, fruit.y)).toBe(false);
    // Below the house, not inside it.
    expect(fruit.y).toBeGreaterThan(MAZE_CLASSIC.spawns.pinky.y);
  });
});

describe('appearing', () => {
  it('arrives at the first threshold and again at the second', () => {
    const first = advance(withDots(FIRST - 1), 1);
    expect(first.fruit).toBeNull();

    const shown = advance({ ...first, dotsEaten: FIRST }, 1);
    expect(shown.fruit).not.toBeNull();
    expect(shown.fruitsShown).toBe(1);
    expect(shown.events).toContainEqual({ type: 'FruitAppeared', kind: 'cherry' });

    // Not a second time for the same threshold.
    const later = advance(shown, 30);
    expect(later.fruitsShown).toBe(1);

    const second = advance({ ...later, dotsEaten: SECOND, fruit: null }, 1);
    expect(second.fruit).not.toBeNull();
    expect(second.fruitsShown).toBe(2);
  });

  it('sits on the maze’s fruit tile and carries the level’s prize', () => {
    const shown = advance(withDots(FIRST, 5), 1);

    expect(shown.fruit).toMatchObject({
      col: MAZE_CLASSIC.spawns.fruit.x,
      row: MAZE_CLASSIC.spawns.fruit.y,
      kind: fruitForLevel(5).kind,
      points: fruitForLevel(5).points,
    });
  });

  it('offers only two a level', () => {
    const twice = advance({ ...withDots(SECOND), fruitsShown: 2 }, 1);
    expect(twice.fruit).toBeNull();
  });
});

describe('expiring and eating', () => {
  const FRUIT_TICKS = Math.round(FRUIT_MS / STEP_MS);

  it('disappears uneaten after 9.5 seconds', () => {
    const shown = advance(withDots(FIRST), 1);

    expect(advance(shown, FRUIT_TICKS - 1).fruit).not.toBeNull();
    expect(advance(shown, FRUIT_TICKS).fruit).toBeNull();
  });

  it('scores the level’s points when Pac-Man reaches it', () => {
    const shown = advance(withDots(FIRST), 1);
    const { x: col, y: row } = MAZE_CLASSIC.spawns.fruit;

    const onIt: GameState = {
      ...shown,
      pacman: { ...shown.pacman, x: tileCentre(col), y: tileCentre(row) },
    };
    const eaten = advance(onIt, 1);

    expect(eaten.fruit).toBeNull();
    expect(eaten.score).toBe(shown.score + fruitForLevel(1).points);
    expect(eaten.events).toContainEqual({
      type: 'FruitEaten',
      kind: 'cherry',
      points: 100,
    });
  });

  it('does not survive a level change', () => {
    const shown = advance(withDots(FIRST), 1);
    const cleared = advanceUntil(
      { ...shown, maze: { ...shown.maze, remaining: 0 } },
      (s) => s.level === 2,
      'the next level',
    );

    expect(cleared.fruit).toBeNull();
    expect(cleared.fruitsShown).toBe(0);
    expect(cleared.dotsEaten).toBe(0);
  });
});
