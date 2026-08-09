import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { createScheduler } from '../../src/sim/modes';
import { PhaseEvent, applyPhaseEvent } from '../../src/sim/phases';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import {
  Direction,
  Phase,
  tileCentre,
  type GameState,
  type GhostMode,
  type GhostName,
  type GhostState,
} from '../../src/sim/types';

/**
 * Shared scaffolding for the gameplay suites.
 *
 * Every mechanic here is a fact about a *running* game, so each test needs the
 * same three lines of boot-gate ceremony first. Keeping them in one place also
 * keeps the tests honest: they drive the simulation through `step`, exactly as
 * the loop does, rather than calling the mechanic's own function directly.
 */

export const IDLE = { dir: Direction.None, serial: 0 } as const;

export function advance(state: GameState, ticks: number): GameState {
  let next = state;
  for (let i = 0; i < ticks; i++) next = step(next, IDLE, STEP_MS);
  return next;
}

/** Tick until `predicate` holds, or fail. Returns the state that satisfied it. */
export function advanceUntil(
  state: GameState,
  predicate: (state: GameState) => boolean,
  what = 'the condition',
  limit = 2000,
): GameState {
  let next = state;
  for (let i = 0; i < limit; i++) {
    next = step(next, IDLE, STEP_MS);
    if (predicate(next)) return next;
  }
  throw new Error(`${what} never happened in ${limit} ticks`);
}

/** A game in Playing, past the countdown, on `level`. */
export function playing(level = 1): GameState {
  const booted = applyPhaseEvent(createInitialState(MAZE_CLASSIC), PhaseEvent.AssetsReady);
  const ready = applyPhaseEvent(booted, PhaseEvent.StartRequested);
  const started = advanceUntil(ready, (s) => s.phase === Phase.Playing, 'the countdown');

  // Jumping straight to a level rather than clearing 244 pellets for each one
  // in between. Speeds and fright duration are read from the table every tick,
  // so the level number covers those; the scatter/chase cursor is the one thing
  // built once at spawn, so it is rebuilt here to match.
  if (level === 1) return started;
  return { ...started, level, modeTimer: createScheduler(level) };
}

export function ghost(state: GameState, name: GhostName): GhostState {
  const found = state.ghosts.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ghost named ${name}`);
  return found;
}

/** Put a ghost on a tile centre, facing `dir`, in whatever mode a case needs. */
export function placeGhost(
  state: GameState,
  name: GhostName,
  col: number,
  row: number,
  mode: GhostMode,
  dir: Direction = Direction.Left,
): GameState {
  const ghosts = state.ghosts.map((candidate) =>
    candidate.name === name
      ? { ...candidate, x: tileCentre(col), y: tileCentre(row), dir, mode }
      : candidate,
  ) as unknown as GameState['ghosts'];
  return { ...state, ghosts };
}

/**
 * Hold Pac-Man still while the rest of the game runs.
 *
 * The chew stall, held open indefinitely — a mechanic the simulation already
 * has rather than a test-only switch inside it. Ghost behaviour is much easier
 * to reason about against a stationary target, and a target that stays put is
 * one the arcade produces too, every time a player stops moving.
 */
export function freezePacman(state: GameState): GameState {
  return { ...state, pacman: { ...state.pacman, stallTicks: Number.MAX_SAFE_INTEGER } };
}

/** Move Pac-Man to a tile centre, facing `dir`, with a clean turn buffer. */
export function placePacman(
  state: GameState,
  col: number,
  row: number,
  dir: Direction = Direction.Left,
): GameState {
  return {
    ...state,
    pacman: {
      ...state.pacman,
      x: tileCentre(col),
      y: tileCentre(row),
      dir,
      pendingDir: Direction.None,
      pendingAge: 0,
      stallTicks: 0,
    },
  };
}
