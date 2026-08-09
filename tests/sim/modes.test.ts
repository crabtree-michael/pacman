import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { globalMode } from '../../src/sim/modes';
import { Direction, GhostMode, opposite, type GameState } from '../../src/sim/types';
import { advance, freezePacman, ghost, placeGhost, playing } from './harness';

/**
 * The scatter/chase alternation (product spec §4.3).
 *
 * The schedule is what gives the game its rhythm: seven seconds where the
 * ghosts leave you alone, twenty where they do not, and a reversal on the
 * boundary that turns a ghost on your tail into a ghost in your face.
 */

/** Level 1 opens with seven seconds of scatter. */
const FIRST_SCATTER_TICKS = Math.round(7000 / STEP_MS);

/** A game with Pac-Man out of the way, so a run can be as long as it needs. */
function watching(level = 1): GameState {
  return freezePacman(playing(level));
}

describe('the level 1 schedule', () => {
  it('scatters for exactly seven seconds, then chases', () => {
    const state = watching();
    expect(globalMode(state)).toBe(GhostMode.Scatter);

    const last = advance(state, FIRST_SCATTER_TICKS - 1);
    expect(globalMode(last)).toBe(GhostMode.Scatter);

    const chasing = advance(last, 1);
    expect(globalMode(chasing)).toBe(GhostMode.Chase);
  });

  it('carries the ghosts on the board into the new mode', () => {
    const chasing = advance(watching(), FIRST_SCATTER_TICKS);
    expect(ghost(chasing, 'blinky').mode).toBe(GhostMode.Chase);
  });

  it('turns every loose ghost round on the transition', () => {
    const before = advance(watching(), FIRST_SCATTER_TICKS - 1);
    const after = advance(before, 1);

    for (const [index, current] of after.ghosts.entries()) {
      const previous = before.ghosts[index];
      if (!previous || previous.mode !== GhostMode.Scatter) continue;
      expect(current.dir, `${current.name} did not turn round`).toBe(opposite(previous.dir));
    }
  });

  it('alternates back to scatter after the chase', () => {
    // From the cursor rather than from twenty seconds of play: the alternation
    // is the thing under test, and it is the same arithmetic either way.
    const chasing: GameState = {
      ...watching(),
      modeTimer: { index: 1, msRemaining: STEP_MS },
    };
    expect(globalMode(advance(chasing, 1))).toBe(GhostMode.Scatter);
  });
});

describe('later levels', () => {
  it('open with a shorter scatter from level 5', () => {
    const state = watching(5);
    const short = Math.round(5000 / STEP_MS);

    expect(globalMode(advance(state, short - 1))).toBe(GhostMode.Scatter);
    expect(globalMode(advance(state, short))).toBe(GhostMode.Chase);
  });
});

describe('a power pellet', () => {
  /** Blinky blue and loose, with the global cursor part-way through a scatter. */
  function frightened(msRemaining: number): GameState {
    const state = placeGhost(watching(), 'blinky', 6, 11, GhostMode.Frightened, Direction.Left);
    return {
      ...state,
      modeTimer: { index: 0, msRemaining: 5000 },
      fright: { active: true, msRemaining, ghostsEaten: 0 },
    };
  }

  it('stops the global timer rather than running it down', () => {
    const before = frightened(3000);
    const after = advance(before, 120);

    // Two seconds of frightened time gone, and not one millisecond of scatter
    // (product spec §4.3).
    expect(after.fright.msRemaining).toBeCloseTo(1000, 6);
    expect(after.modeTimer).toEqual(before.modeTimer);
  });

  it('hands the ghosts back to whatever the cursor says now', () => {
    const state: GameState = {
      ...frightened(STEP_MS),
      // Frightened during a chase: the ghosts must come back chasing, not
      // scattering, however they were caught out.
      modeTimer: { index: 1, msRemaining: 20_000 },
    };

    const over = advance(state, 1);
    expect(over.fright.active).toBe(false);
    expect(ghost(over, 'blinky').mode).toBe(GhostMode.Chase);
  });
});
