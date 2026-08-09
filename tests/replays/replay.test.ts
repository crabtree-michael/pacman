import { describe, expect, it } from 'vitest';
import { Direction, GhostMode, Phase } from '../../src/sim/types';
import { HUNT_REPLAY, LAP_REPLAY, POWER_REPLAY, digest, runReplay } from './harness';

/**
 * The determinism guarantee the whole architecture is built on (§1, §3.2, §9).
 *
 * The recorded digests below move whenever gameplay does — that is the point.
 * Re-baseline them in the same commit as the behaviour change, never as a
 * drive-by fix, because an unexplained digest change is exactly the signal this
 * test exists to raise.
 */
describe('whole-game replay', () => {
  it('is bit-identical across runs', () => {
    expect(digest(runReplay(LAP_REPLAY))).toBe(digest(runReplay(LAP_REPLAY)));
    expect(digest(runReplay(POWER_REPLAY))).toBe(digest(runReplay(POWER_REPLAY)));
    // The one that leans on the PRNG, through the frightened ghosts' coin flip.
    expect(digest(runReplay(HUNT_REPLAY))).toBe(digest(runReplay(HUNT_REPLAY)));
  });

  it('matches the recorded digest', () => {
    expect(digest(runReplay(LAP_REPLAY))).toMatchSnapshot();
    expect(digest(runReplay(POWER_REPLAY))).toMatchSnapshot();
    expect(digest(runReplay(HUNT_REPLAY))).toMatchSnapshot();
  });

  it('is sensitive to the input stream', () => {
    const altered = {
      ...LAP_REPLAY,
      events: [...LAP_REPLAY.events, { tick: 860, dir: Direction.Down }],
    };
    expect(digest(runReplay(altered))).not.toBe(digest(runReplay(LAP_REPLAY)));
  });

  it('leaves Pac-Man somewhere legal on the board', () => {
    const state = runReplay(LAP_REPLAY);
    expect(state.pacman.x).toBeGreaterThanOrEqual(0);
    expect(state.pacman.x).toBeLessThan(state.maze.data.cols * 256);
    expect(state.pacman.y).toBeGreaterThanOrEqual(0);
    expect(state.pacman.y).toBeLessThan(state.maze.data.rows * 256);
  });

  it('clears the pellets it drove over', () => {
    const state = runReplay(LAP_REPLAY);

    // 24 pellets at 10 points, and a board that agrees it is 24 lighter.
    expect(state.score).toBe(240);
    expect(state.dotsEaten).toBe(24);
    expect(state.maze.remaining).toBe(244 - 24);
    expect(state.phase).toBe(Phase.Playing);
  });

  it('lets the ghosts run the hunt', () => {
    const state = runReplay(HUNT_REPLAY);

    // Caught once by a ghost that found him on its own, and back on the board
    // after the respawn — the whole ghost life cycle, in one digest.
    expect(state.lives).toBe(2);
    expect(state.phase).toBe(Phase.Playing);
    expect(state.fright.active).toBe(false);
    // The house refilled on the respawn and is letting them out again.
    expect(state.ghosts.map((ghost) => ghost.mode)).toContain(GhostMode.House);
  });

  it('ends the power-pellet run mid-fright', () => {
    const state = runReplay(POWER_REPLAY);

    // 17 pellets and the power pellet at the end of the run.
    expect(state.score).toBe(17 * 10 + 50);
    expect(state.fright.active).toBe(true);
    expect(state.fright.msRemaining).toBeGreaterThan(0);
    expect(state.fright.ghostsEaten).toBe(0);
  });
});
