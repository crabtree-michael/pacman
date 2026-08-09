import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { tuningForLevel } from '../../src/sim/levels';
import { actorTile } from '../../src/sim/movement';
import { Direction, GhostMode, Phase, type GameState } from '../../src/sim/types';
import {
  advance,
  advanceUntil,
  freezePacman,
  ghost,
  placeGhost,
  playing,
} from './harness';

/**
 * Who is let out of the ghost house, and when (product spec §4.3).
 *
 * The dot counter is the difficulty dial for the opening of a level: it is why
 * the first few seconds are survivable, and why standing still stops being a
 * plan after four of them.
 */

const TIMEOUT_TICKS = Math.round(tuningForLevel(1).houseTimeoutMs / STEP_MS);

/** A game with Pac-Man held still, so only the house is moving. */
function watching(level = 1): GameState {
  return freezePacman(playing(level));
}

/** Pretend the player has eaten `dots` since the house last filled up. */
function withDots(state: GameState, dots: number): GameState {
  return { ...state, house: { ...state.house, dots } };
}

describe('the queue', () => {
  it('starts Blinky outside and the other three in', () => {
    const state = playing();
    expect(ghost(state, 'blinky').mode).toBe(GhostMode.Scatter);
    for (const name of ['pinky', 'inky', 'clyde'] as const) {
      expect(ghost(state, name).mode).toBe(GhostMode.House);
    }
  });

  it('lets Pinky go at once, on nought dots', () => {
    expect(ghost(advance(watching(), 1), 'pinky').mode).toBe(GhostMode.Leaving);
  });

  it('holds Inky until the thirtieth dot', () => {
    const tuning = tuningForLevel(1);
    const afterPinky = advance(watching(), 1);

    const short = advance(withDots(afterPinky, tuning.houseDots.inky - 1), 1);
    expect(ghost(short, 'inky').mode).toBe(GhostMode.House);

    const earned = advance(withDots(afterPinky, tuning.houseDots.inky), 1);
    expect(ghost(earned, 'inky').mode).toBe(GhostMode.Leaving);
  });

  it('holds Clyde until the sixtieth, and keeps the order', () => {
    const tuning = tuningForLevel(1);
    const afterPinky = advance(watching(), 1);

    // Clyde's own threshold met, Inky's not: Clyde still waits, because the
    // house empties in order rather than by whoever qualifies first.
    const jumped = advance(withDots(afterPinky, tuning.houseDots.clyde), 1);
    expect(ghost(jumped, 'inky').mode).toBe(GhostMode.Leaving);
    expect(ghost(jumped, 'clyde').mode).toBe(GhostMode.House);

    expect(ghost(advance(jumped, 1), 'clyde').mode).toBe(GhostMode.Leaving);
  });

  it('empties the whole house from level 3, dots or no dots', () => {
    const state = advance(watching(3), 3);
    for (const name of ['pinky', 'inky', 'clyde'] as const) {
      expect(ghost(state, name).mode).not.toBe(GhostMode.House);
    }
  });
});

describe('the no-dots-eaten timeout', () => {
  it('releases the next ghost anyway, so play cannot stall', () => {
    // Pac-Man is frozen, so nothing is ever eaten and only the clock can move.
    const afterPinky = advance(watching(), 1);

    expect(ghost(advance(afterPinky, TIMEOUT_TICKS - 1), 'inky').mode).toBe(GhostMode.House);
    expect(ghost(advance(afterPinky, TIMEOUT_TICKS), 'inky').mode).toBe(GhostMode.Leaving);
  });

  it('restarts with each release, so the house empties one at a time', () => {
    const state = advance(watching(), 1 + TIMEOUT_TICKS);
    expect(ghost(state, 'clyde').mode).toBe(GhostMode.House);
    expect(ghost(advance(state, TIMEOUT_TICKS), 'clyde').mode).toBe(GhostMode.Leaving);
  });

  it('comes down to three seconds from level 5', () => {
    // A table fact rather than an observed one, and it has to be: from level 3
    // every threshold is nought, so the house empties on the dot counter
    // before the timeout it would fall back to has a chance to matter.
    expect(tuningForLevel(4).houseTimeoutMs).toBe(4000);
    expect(tuningForLevel(5).houseTimeoutMs).toBe(3000);
  });
});

describe('coming out', () => {
  it('emerges above the door, facing left, in the mode of the day', () => {
    const out = advanceUntil(
      watching(),
      (state) => ghost(state, 'pinky').mode === GhostMode.Scatter,
      'Pinky to leave the house',
      600,
    );

    const pinky = ghost(out, 'pinky');
    expect(actorTile(MAZE_CLASSIC, pinky)).toEqual({
      col: MAZE_CLASSIC.house.door.x,
      row: MAZE_CLASSIC.house.door.y,
    });
    // The arcade turns them left out of the door, every time.
    expect(pinky.dir).toBe(Direction.Left);
  });

  it('is not something Pac-Man can run into on the way', () => {
    // A ghost part-way out is behind a door Pac-Man cannot open, so standing on
    // its tile is not contact.
    const leaving = placeGhost(
      watching(),
      'pinky',
      MAZE_CLASSIC.spawns.pacman.x,
      MAZE_CLASSIC.spawns.pacman.y,
      GhostMode.Leaving,
    );
    expect(advance(leaving, 1).phase).toBe(Phase.Playing);
  });
});

describe('after a death', () => {
  it('fills the house again and starts the counter over', () => {
    const caught = advanceUntil(
      placeGhost(playing(), 'blinky', 12, MAZE_CLASSIC.spawns.pacman.y, GhostMode.Chase),
      (state) => state.phase === Phase.Dying,
      'the collision',
    );
    const respawned = advanceUntil(caught, (state) => state.phase === Phase.Ready, 'the respawn');

    expect(respawned.house.dots).toBe(0);
    for (const name of ['pinky', 'inky', 'clyde'] as const) {
      expect(ghost(respawned, name).mode).toBe(GhostMode.House);
    }
    // The board keeps its eaten pellets; the house does not keep their count.
    expect(respawned.dotsEaten).toBeGreaterThan(0);
  });
});
