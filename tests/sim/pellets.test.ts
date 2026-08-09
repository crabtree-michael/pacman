import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { Pellet, pelletAt } from '../../src/sim/maze';
import { PELLET_STALL_TICKS, POWER_PELLET_STALL_TICKS } from '../../src/sim/pacman';
import { PELLET_POINTS, POWER_PELLET_POINTS } from '../../src/sim/scoring';
import { step } from '../../src/sim/step';
import { Direction, Phase } from '../../src/sim/types';
import { IDLE, advance, advanceUntil, placePacman, playing } from './harness';

/**
 * Pellet collection (product spec §4.1, §4.2, §4.4).
 *
 * Pac-Man's spawn sits at (13, 23) in a stretch of corridor whose left
 * neighbour carries a pellet and whose far left end carries a power pellet, so
 * every case below is reachable by letting him walk the way he already faces.
 */

const ROW = MAZE_CLASSIC.spawns.pacman.y;

describe('eating a pellet', () => {
  it('scores 10 and takes it off the board', () => {
    const start = playing();
    const eaten = advanceUntil(start, (s) => s.score > 0, 'a pellet');

    expect(eaten.score).toBe(PELLET_POINTS);
    expect(eaten.maze.remaining).toBe(start.maze.remaining - 1);
    expect(eaten.dotsEaten).toBe(1);
    expect(eaten.events).toContainEqual({ type: 'PelletEaten', x: 12, y: ROW });
    expect(pelletAt(eaten.maze, 12, ROW)).toBe(Pellet.None);
  });

  it('leaves the previous frame’s board untouched', () => {
    // The renderer interpolates from the previous state, so writing the pellet
    // bitmap in place would erase a pellet out of a frame already being drawn.
    let previous = playing();
    let current = previous;

    for (let tick = 0; tick < 100 && current.score === 0; tick++) {
      previous = current;
      current = step(current, IDLE, STEP_MS);
    }
    expect(current.score).toBe(PELLET_POINTS);

    expect(current.maze.pellets).not.toBe(previous.maze.pellets);
    expect(pelletAt(previous.maze, 12, ROW)).toBe(Pellet.Normal);
    expect(pelletAt(current.maze, 12, ROW)).toBe(Pellet.None);
  });

  it('costs a tick of movement while he chews (spec §4.2)', () => {
    const eaten = advanceUntil(playing(), (s) => s.score > 0, 'a pellet');
    expect(eaten.pacman.stallTicks).toBe(PELLET_STALL_TICKS);

    const stalled = step(eaten, IDLE, STEP_MS);
    expect(stalled.pacman.x).toBe(eaten.pacman.x);
    expect(stalled.pacman.stallTicks).toBe(0);

    // ...and he is moving again on the tick after that.
    expect(step(stalled, IDLE, STEP_MS).pacman.x).not.toBe(eaten.pacman.x);
  });

  it('does not score twice for the same tile', () => {
    const eaten = advanceUntil(playing(), (s) => s.score > 0, 'a pellet');
    // Still standing on the tile he just cleared, for the chew and beyond.
    expect(advance(eaten, 3).score).toBe(PELLET_POINTS);
  });
});

describe('eating a power pellet', () => {
  const powered = () =>
    advanceUntil(
      placePacman(playing(), 2, ROW, Direction.Left),
      (s) => s.fright.active,
      'the power pellet',
    );

  it('scores 50 and starts the frightened timer', () => {
    const state = powered();

    // 10 for the ordinary pellet he was standing on, then 50 for the big one.
    expect(state.score).toBe(PELLET_POINTS + POWER_PELLET_POINTS);
    expect(state.fright.msRemaining).toBe(6000); // Level 1, product spec §4.3.
    expect(state.fright.ghostsEaten).toBe(0);
    expect(state.events).toContainEqual({ type: 'PowerPelletEaten', x: 1, y: ROW });
  });

  it('counts towards the level’s collectibles like any other', () => {
    const state = powered();
    expect(state.maze.remaining).toBe(242);
    expect(state.dotsEaten).toBe(2);
  });

  it('costs three ticks of movement', () => {
    expect(powered().pacman.stallTicks).toBe(POWER_PELLET_STALL_TICKS);
  });
});

describe('clearing the board', () => {
  it('ends the level on the last collectible', () => {
    const start = playing();
    // One pellet left, the one Pac-Man is about to walk onto.
    const oneLeft = { ...start, maze: { ...start.maze, remaining: 1 } };

    const cleared = advanceUntil(oneLeft, (s) => s.phase !== Phase.Playing, 'the level clear');
    expect(cleared.phase).toBe(Phase.LevelComplete);
    expect(cleared.maze.remaining).toBe(0);
    expect(cleared.events).toContainEqual({ type: 'LevelCleared' });
  });
});
