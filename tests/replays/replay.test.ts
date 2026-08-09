import { describe, expect, it } from 'vitest';
import { Direction } from '../../src/sim/types';
import { LAP_REPLAY, digest, runReplay } from './harness';

/**
 * The determinism guarantee the whole architecture is built on (§1, §3.2, §9).
 *
 * When gameplay lands, the recorded digest below will change — that is the
 * point. It should be re-baselined in the same commit as the behaviour change,
 * never as a drive-by fix, because an unexplained digest change is exactly the
 * signal this test exists to raise.
 */
describe('whole-game replay', () => {
  it('is bit-identical across runs', () => {
    expect(digest(runReplay(LAP_REPLAY))).toBe(digest(runReplay(LAP_REPLAY)));
  });

  it('matches the recorded digest', () => {
    expect(digest(runReplay(LAP_REPLAY))).toMatchSnapshot();
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

  it('reaches the Playing phase and stays there', () => {
    // TODO(mechanics): once pellets and deaths exist this replay will move
    // through more phases, and this assertion should get sharper.
    expect(runReplay(LAP_REPLAY).phase).toBe('Playing');
  });
});
