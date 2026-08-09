import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { PhaseEvent, applyPhaseEvent } from '../../src/sim/phases';
import { createInitialState } from '../../src/sim/state';
import { step } from '../../src/sim/step';
import { DEFAULT_SEED } from '../../src/sim/rng';
import { Direction, type GameState } from '../../src/sim/types';

/**
 * Headless replay driver (architecture §9, "Whole-game replays").
 *
 * A replay is a stream of `(tick, Direction)` pairs — the same shape the input
 * controller produces at runtime, and the same shape a server would need to
 * re-validate a submitted score (§8.3). Running one and hashing the final state
 * turns "did anything about the game change?" into a single cheap assertion.
 */

export interface ReplayEvent {
  tick: number;
  dir: Direction;
}

export interface Replay {
  name: string;
  seed: number;
  ticks: number;
  events: readonly ReplayEvent[];
}

/**
 * A new game driven through the boot gate to the Ready countdown — the same
 * place the app lands once its assets resolve, and tick 0 of every replay.
 */
export function startedState(seed = DEFAULT_SEED): GameState {
  const booted = applyPhaseEvent(
    createInitialState(MAZE_CLASSIC, 1, seed),
    PhaseEvent.AssetsReady,
  );
  return applyPhaseEvent(booted, PhaseEvent.StartRequested);
}

/**
 * Run a replay to completion and return the final state.
 *
 * The serial counter mirrors `InputController`: it advances only when a *new*
 * intent is latched, which is what lets the 400 ms turn buffer expire.
 */
export function runReplay(replay: Replay): GameState {
  let state = startedState(replay.seed);
  let dir: Direction = Direction.None;
  let serial = 0;
  let cursor = 0;

  for (let tick = 0; tick < replay.ticks; tick++) {
    while (cursor < replay.events.length && replay.events[cursor]!.tick === tick) {
      dir = replay.events[cursor]!.dir;
      serial++;
      cursor++;
    }
    state = step(state, { dir, serial }, STEP_MS);
  }

  return state;
}

/**
 * FNV-1a over a canonical rendering of the state.
 *
 * Hand-rolled rather than `crypto`, so the digest is identical in Node, in a
 * browser, and in whatever runtime a future score validator runs in — the
 * bit-identical replay guarantee is worthless if the hash itself is portable
 * only by accident.
 */
export function digest(state: GameState): string {
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  };

  feed(canonical(state));
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Everything in the state that a behaviour change could move.
 *
 * `maze.data` is deliberately excluded: it is the static board, identical in
 * every run, and including it would only make the digest churn when the maze
 * file is reformatted.
 */
export function canonical(state: GameState): string {
  const parts: string[] = [
    `phase=${state.phase}`,
    `phaseTimer=${state.phaseTimer.toFixed(6)}`,
    `level=${state.level}`,
    `score=${state.score}`,
    `lives=${state.lives}`,
    `extraLife=${String(state.extraLifeAwarded)}`,
    `rng=${state.rng}`,
    `serial=${state.lastInputSerial}`,
    `fright=${String(state.fright.active)}:${state.fright.msRemaining}:${state.fright.ghostsEaten}`,
    `remaining=${state.maze.remaining}`,
    `pellets=${pelletChecksum(state.maze.pellets)}`,
    `pacman=${state.pacman.x},${state.pacman.y},${state.pacman.dir},${state.pacman.pendingDir},${state.pacman.pendingAge.toFixed(6)},${state.pacman.animTicks}`,
  ];

  for (const ghost of state.ghosts) {
    parts.push(`${ghost.name}=${ghost.x},${ghost.y},${ghost.dir},${ghost.mode},${ghost.animTicks}`);
  }

  parts.push(`events=${state.events.map((event) => event.type).join('|')}`);
  return parts.join(';');
}

function pelletChecksum(pellets: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pellets.length; i++) {
    hash ^= pellets[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * A scripted lap of the lower-left of the board.
 *
 * Chosen to exercise turn buffering, a reversal, a request that never becomes
 * legal, and the side tunnel — not to be interesting play. Ticks are 60 Hz.
 */
export const LAP_REPLAY: Replay = {
  name: 'lower-left lap',
  seed: DEFAULT_SEED,
  // 3 s of the Ready phase plus 12 s of play.
  ticks: 900,
  events: [
    { tick: 200, dir: Direction.Left }, // Latched during Ready; must survive it.
    { tick: 240, dir: Direction.Up }, // Illegal here — expires after 400 ms.
    { tick: 300, dir: Direction.Right }, // Reversal, applied mid-corridor.
    { tick: 420, dir: Direction.Down },
    { tick: 520, dir: Direction.Left },
    { tick: 700, dir: Direction.Up },
    { tick: 820, dir: Direction.Left },
  ],
};
