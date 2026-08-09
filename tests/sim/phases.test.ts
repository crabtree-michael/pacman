import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import {
  DYING_MS,
  GAME_OVER_MS,
  LEVEL_COMPLETE_MS,
  PhaseEvent,
  READY_MS,
  applyPhaseEvent,
} from '../../src/sim/phases';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { Direction, Phase, tileCentre, type GameState } from '../../src/sim/types';

/**
 * The game-flow machine (architecture §3.3, product spec §4.6).
 *
 * These assert the flow itself — which phases follow which, what each one
 * resets, and how long the timed ones last. Gameplay is deliberately absent:
 * the machine is what stays put while mechanics land underneath it.
 */

const IDLE = { dir: Direction.None, serial: 0 } as const;

/** Run `ticks` simulation ticks with no input. */
function advance(state: GameState, ticks: number): GameState {
  let next = state;
  for (let i = 0; i < ticks; i++) next = step(next, IDLE, STEP_MS);
  return next;
}

/** Tick until the phase changes, or fail. Returns the state on the first new phase. */
function advanceUntilPhaseChanges(state: GameState, limit = 1000): GameState {
  let next = state;
  for (let i = 0; i < limit; i++) {
    next = step(next, IDLE, STEP_MS);
    if (next.phase !== state.phase) return next;
  }
  throw new Error(`still in ${state.phase} after ${limit} ticks`);
}

function booted(): GameState {
  return applyPhaseEvent(createInitialState(MAZE_CLASSIC), PhaseEvent.AssetsReady);
}

/** A game sitting at the Ready countdown, as the app is once assets resolve. */
function ready(): GameState {
  return applyPhaseEvent(booted(), PhaseEvent.StartRequested);
}

/** A game in Playing, past the countdown. */
function playing(): GameState {
  const state = advanceUntilPhaseChanges(ready());
  expect(state.phase).toBe(Phase.Playing);
  return state;
}

describe('boot gate', () => {
  it('starts in Boot and advances nothing there', () => {
    const state = createInitialState(MAZE_CLASSIC);
    expect(state.phase).toBe(Phase.Boot);

    // Nothing may move before the assets it would be drawn with exist.
    const later = advance(state, 600);
    expect(later.phase).toBe(Phase.Boot);
    expect(later.pacman.x).toBe(state.pacman.x);
  });

  it('ignores events that do not apply to the phase', () => {
    const state = createInitialState(MAZE_CLASSIC);
    // Same object back: nothing was cloned, nothing was touched.
    expect(applyPhaseEvent(state, PhaseEvent.PauseRequested)).toBe(state);
    expect(applyPhaseEvent(state, PhaseEvent.CountdownElapsed)).toBe(state);
  });

  it('opens on AssetsReady and reaches Ready on the start gesture', () => {
    expect(booted().phase).toBe(Phase.Attract);
    expect(ready().phase).toBe(Phase.Ready);
  });

  it('records every transition as an event', () => {
    expect(booted().events).toEqual([
      { type: 'PhaseChanged', from: Phase.Boot, to: Phase.Attract },
    ]);
  });
});

describe('Ready', () => {
  it('starts a fresh game', () => {
    const state = ready();
    expect(state.level).toBe(1);
    expect(state.score).toBe(0);
    expect(state.lives).toBe(3);
    expect(state.maze.remaining).toBe(244);
    expect(state.phaseTimer).toBe(READY_MS);
  });

  it('holds for exactly the countdown, then plays', () => {
    const ticks = Math.round(READY_MS / STEP_MS);
    const last = advance(ready(), ticks - 1);
    expect(last.phase).toBe(Phase.Ready);
    expect(step(last, IDLE, STEP_MS).phase).toBe(Phase.Playing);
  });

  it('freezes Pac-Man for the whole countdown', () => {
    const start = ready();
    const end = advance(start, Math.round(READY_MS / STEP_MS) - 1);
    expect(end.pacman.x).toBe(start.pacman.x);
    expect(end.pacman.y).toBe(start.pacman.y);
  });
});

describe('Playing', () => {
  it('moves Pac-Man once the countdown is done', () => {
    const start = playing();
    const end = advance(start, 30);
    expect(end.pacman.x).not.toBe(start.pacman.x);
  });

  it('goes to LevelComplete when the board is cleared', () => {
    const state = playing();
    // Standing in for pellet collection, which is TODO(mechanics): the machine
    // only cares that the count reached zero.
    state.maze.remaining = 0;

    const cleared = step(state, IDLE, STEP_MS);
    expect(cleared.phase).toBe(Phase.LevelComplete);
    expect(cleared.events).toContainEqual({ type: 'LevelCleared' });
  });
});

describe('pause', () => {
  it('suspends Playing and returns to it untouched', () => {
    const start = advance(playing(), 40);
    const paused = applyPhaseEvent(start, PhaseEvent.PauseRequested);
    expect(paused.phase).toBe(Phase.Paused);
    expect(paused.resumePhase).toBe(Phase.Playing);

    // A paused game does not tick at all.
    const held = advance(paused, 120);
    expect(held.phase).toBe(Phase.Paused);
    expect(held.pacman.x).toBe(start.pacman.x);
    expect(held.pacman.animTicks).toBe(start.pacman.animTicks);

    const resumed = applyPhaseEvent(held, PhaseEvent.ResumeRequested);
    expect(resumed.phase).toBe(Phase.Playing);
    expect(resumed.pacman.x).toBe(start.pacman.x);
  });

  it('keeps the remaining countdown when it suspends Ready', () => {
    const start = advance(ready(), 60);
    const paused = applyPhaseEvent(start, PhaseEvent.PauseRequested);
    const resumed = applyPhaseEvent(advance(paused, 300), PhaseEvent.ResumeRequested);

    expect(resumed.phase).toBe(Phase.Ready);
    // Resuming must not re-enter Ready — that would restart the countdown.
    expect(resumed.phaseTimer).toBe(start.phaseTimer);
  });

  it('ignores a second pause and a resume that is not paused', () => {
    const paused = applyPhaseEvent(playing(), PhaseEvent.PauseRequested);
    expect(applyPhaseEvent(paused, PhaseEvent.PauseRequested)).toBe(paused);

    const running = playing();
    expect(applyPhaseEvent(running, PhaseEvent.ResumeRequested)).toBe(running);
  });

  it('restarts out of a pause with a clean scoreboard', () => {
    const scored: GameState = { ...playing(), score: 4200, lives: 1, level: 3 };
    const paused = applyPhaseEvent(scored, PhaseEvent.PauseRequested);
    const restarted = applyPhaseEvent(paused, PhaseEvent.RestartRequested);

    expect(restarted.phase).toBe(Phase.Ready);
    expect(restarted.score).toBe(0);
    expect(restarted.lives).toBe(3);
    expect(restarted.level).toBe(1);
    expect(restarted.phaseTimer).toBe(READY_MS);
  });
});

describe('death and game over', () => {
  it('costs a life, freezes, then respawns at the spawn tile', () => {
    const moved = advance(playing(), 40);
    const dying = applyPhaseEvent(moved, PhaseEvent.PacmanCaught);

    expect(dying.phase).toBe(Phase.Dying);
    expect(dying.lives).toBe(2);
    expect(dying.events).toContainEqual({ type: 'Death' });

    const held = advance(dying, Math.round(DYING_MS / STEP_MS) - 1);
    expect(held.phase).toBe(Phase.Dying);

    const respawned = step(held, IDLE, STEP_MS);
    expect(respawned.phase).toBe(Phase.Ready);
    expect(respawned.pacman.x).toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.x));
    expect(respawned.pacman.y).toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.y));
    expect(respawned.pacman.pendingDir).toBe(Direction.None);
  });

  it("keeps the board's eaten pellets across a respawn", () => {
    const state = playing();
    state.maze.remaining = 100;

    const dying = applyPhaseEvent(state, PhaseEvent.PacmanCaught);
    const respawned = advanceUntilPhaseChanges(dying);
    expect(respawned.phase).toBe(Phase.Ready);
    expect(respawned.maze.remaining).toBe(100);
  });

  it('ends the game on the last life and falls back to attract', () => {
    const onLastLife: GameState = { ...playing(), lives: 1 };
    const dying = applyPhaseEvent(onLastLife, PhaseEvent.PacmanCaught);
    expect(dying.lives).toBe(0);

    const over = advanceUntilPhaseChanges(dying);
    expect(over.phase).toBe(Phase.GameOver);

    const held = advance(over, Math.round(GAME_OVER_MS / STEP_MS) - 1);
    expect(held.phase).toBe(Phase.GameOver);
    expect(step(held, IDLE, STEP_MS).phase).toBe(Phase.Attract);
  });

  it('plays again from the game over screen', () => {
    const over: GameState = { ...playing(), phase: Phase.GameOver, score: 900, lives: 0 };
    const again = applyPhaseEvent(over, PhaseEvent.RestartRequested);

    expect(again.phase).toBe(Phase.Ready);
    expect(again.score).toBe(0);
    expect(again.lives).toBe(3);
  });
});

describe('level progression', () => {
  it('refills the board and counts up after the level card', () => {
    const state = playing();
    state.maze.remaining = 0;
    state.score = 2600;
    state.lives = 2;

    const complete = step(state, IDLE, STEP_MS);
    expect(complete.phase).toBe(Phase.LevelComplete);
    expect(complete.phaseTimer).toBe(LEVEL_COMPLETE_MS);
    // The board stays cleared while the card is up.
    expect(complete.maze.remaining).toBe(0);

    const next = advanceUntilPhaseChanges(complete);
    expect(next.phase).toBe(Phase.Ready);
    expect(next.level).toBe(2);
    expect(next.maze.remaining).toBe(244);
    // Progress carries over; only the board resets.
    expect(next.score).toBe(2600);
    expect(next.lives).toBe(2);
  });
});
