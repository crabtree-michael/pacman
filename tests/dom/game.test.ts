// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game, type GameOptions } from '../../src/app/game';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { LEVEL_COMPLETE_MS, READY_MS } from '../../src/sim/phases';
import { Direction, Phase, type GameState } from '../../src/sim/types';

/**
 * The seam between the simulation and the device (src/app/game.ts).
 *
 * The collaborators are fakes, which is the point: `Game` is wiring, and wiring
 * is worth testing precisely because none of it is visible in the simulation's
 * own tests. A canvas would add nothing here.
 */

function fakes() {
  const view = { render: vi.fn() };
  const chrome = { update: vi.fn() };
  const input = {
    sample: vi.fn(),
    snapshot: vi.fn(() => ({ dir: Direction.None, serial: 0 })),
    reset: vi.fn(),
  };
  const saved: number[] = [];
  const highScore = { load: () => 0, save: (score: number) => void saved.push(score) };

  const options: GameOptions = {
    maze: MAZE_CLASSIC,
    view,
    chrome,
    input,
    highScore,
    now: () => 0,
  };
  return { options, view, chrome, input, saved };
}

/** A game driven through the boot gate, exactly as `main.ts` does it. */
function started(options: GameOptions): Game {
  const game = new Game(options);
  game.assetsLoaded();
  game.startGame();
  return game;
}

function advance(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.advance(STEP_MS);
}

const READY_TICKS = Math.round(READY_MS / STEP_MS);

let hidden = false;

beforeEach(() => {
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Game', () => {
  it('holds at the boot gate until the assets resolve', () => {
    const { options } = fakes();
    const game = new Game(options);

    expect(game.phase).toBe(Phase.Boot);
    advance(game, 60);
    expect(game.phase).toBe(Phase.Boot);

    game.assetsLoaded();
    expect(game.phase).toBe(Phase.Attract);
    game.startGame();
    expect(game.phase).toBe(Phase.Ready);
  });

  it('runs the countdown and then plays', () => {
    const { options } = fakes();
    const game = started(options);

    advance(game, READY_TICKS - 1);
    expect(game.phase).toBe(Phase.Ready);

    advance(game, 1);
    expect(game.phase).toBe(Phase.Playing);
  });

  it('polls input once per tick and draws once per frame', () => {
    const { options, view, chrome, input } = fakes();
    const game = started(options);

    advance(game, 3);
    game.draw(0.25);

    expect(input.sample).toHaveBeenCalledTimes(3);
    expect(view.render).toHaveBeenCalledTimes(1);
    expect(chrome.update).toHaveBeenCalledTimes(1);

    const [previous, current, alpha] = view.render.mock.calls[0] as [
      GameState,
      GameState,
      number,
    ];
    expect(alpha).toBe(0.25);
    expect(current).toBe(game.state);
    // Two distinct states to interpolate between (architecture §2.4).
    expect(previous).not.toBe(current);
  });

  it('pauses, freezes, and resumes where it left off', () => {
    const { options, input } = fakes();
    const game = started(options);
    advance(game, READY_TICKS + 20);

    const before = game.state.pacman.x;
    expect(game.pause()).toBe(true);
    expect(game.isPaused).toBe(true);
    // A held direction must not walk Pac-Man on the player's return.
    expect(input.reset).toHaveBeenCalled();

    advance(game, 60);
    expect(game.state.pacman.x).toBe(before);

    expect(game.resume()).toBe(true);
    expect(game.phase).toBe(Phase.Playing);
    advance(game, 20);
    expect(game.state.pacman.x).not.toBe(before);
  });

  it('reports a pause that did not apply', () => {
    const { options } = fakes();
    const game = new Game(options);
    // Nothing to pause at the boot gate.
    expect(game.pause()).toBe(false);
    expect(game.phase).toBe(Phase.Boot);
  });

  it('pauses when the tab is backgrounded, and stays paused on return', () => {
    const { options } = fakes();
    const game = started(options);
    game.start();

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(game.isPaused).toBe(true);
    expect(game.loop.isRunning).toBe(false);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    // Frames flow again — for the pause overlay. The game does not.
    expect(game.loop.isRunning).toBe(true);
    expect(game.isPaused).toBe(true);

    game.destroy();
  });

  it('restarts out of a pause', () => {
    const { options } = fakes();
    const game = started(options);
    advance(game, READY_TICKS + 30);
    game.state.score = 500;

    game.pause();
    expect(game.restart()).toBe(true);

    expect(game.phase).toBe(Phase.Ready);
    expect(game.state.score).toBe(0);
    // The high score survives the game that earned it.
    expect(game.bestScore).toBe(500);
  });

  it('clears the input latch whenever a life starts', () => {
    const { options, input } = fakes();
    const game = new Game(options);

    game.assetsLoaded();
    expect(input.reset).not.toHaveBeenCalled();

    game.startGame();
    expect(input.reset).toHaveBeenCalledTimes(1);

    advance(game, READY_TICKS);
    // Standing in for eating the last pellet, which is TODO(mechanics).
    game.state.maze.remaining = 0;
    advance(game, 1);
    expect(game.phase).toBe(Phase.LevelComplete);

    advance(game, Math.round(LEVEL_COMPLETE_MS / STEP_MS));
    expect(game.phase).toBe(Phase.Ready);
    // Driven by the simulation's own PhaseChanged event, not by the caller.
    expect(input.reset).toHaveBeenCalledTimes(2);
  });

  it('persists a new high score as it is set', () => {
    const { options, saved } = fakes();
    const game = started(options);

    expect(game.bestScore).toBe(0);
    game.state.score = 120;
    advance(game, 1);

    expect(game.bestScore).toBe(120);
    expect(saved).toEqual([120]);
  });
});
