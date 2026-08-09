/**
 * Simulation types. This module — and everything else under `sim/` — is pure:
 * no DOM, no timers, no `Math.random`. See the architecture doc §1 and §6.
 */

import type { MazeData } from '../data/maze-classic';

/**
 * Sub-tile resolution. Positions are integers in 1/256ths of a tile, so
 * "exactly at a tile centre" is an exact comparison rather than an epsilon
 * test, there is no float drift, and replays are bit-identical across devices
 * (architecture §3.2).
 */
export const SUBTILE = 256;
export const HALF_TILE = SUBTILE / 2;

export const Direction = {
  None: 0,
  Up: 1,
  Left: 2,
  Down: 3,
  Right: 4,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/**
 * Ghost exit preference order. Up → Left → Down → Right is the arcade's
 * tie-break when two exits are equidistant from the target tile; reproducing
 * it is what makes ghost routes look right (architecture §3.5).
 */
export const DIRECTION_PRIORITY: readonly Direction[] = [
  Direction.Up,
  Direction.Left,
  Direction.Down,
  Direction.Right,
];

export const DIRECTION_DELTA: Readonly<Record<Direction, { x: number; y: number }>> = {
  [Direction.None]: { x: 0, y: 0 },
  [Direction.Up]: { x: 0, y: -1 },
  [Direction.Left]: { x: -1, y: 0 },
  [Direction.Down]: { x: 0, y: 1 },
  [Direction.Right]: { x: 1, y: 0 },
};

export function opposite(direction: Direction): Direction {
  switch (direction) {
    case Direction.Up:
      return Direction.Down;
    case Direction.Down:
      return Direction.Up;
    case Direction.Left:
      return Direction.Right;
    case Direction.Right:
      return Direction.Left;
    default:
      return Direction.None;
  }
}

/**
 * Game-flow states (product spec §4.6, architecture §3.2).
 *
 * `Boot` is the loading gate: assets must resolve before the Ready countdown
 * starts (architecture §5.3), and the spec's flow diagram opens with it. The
 * architecture's §3.2 list omits it because it lists what the *simulation*
 * tracks; holding it here rather than in the app keeps the whole flow in one
 * machine, and gives the overlay a phase to draw a loading card from.
 */
export const Phase = {
  Boot: 'Boot',
  Attract: 'Attract',
  Ready: 'Ready',
  Playing: 'Playing',
  Dying: 'Dying',
  LevelComplete: 'LevelComplete',
  GameOver: 'GameOver',
  Paused: 'Paused',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

/** A moving entity. `x`/`y` are absolute positions in sub-tile units. */
export interface Actor {
  x: number;
  y: number;
  dir: Direction;
  /** Speed in sub-tile units per simulation tick. */
  speed: number;
  /** Animation cursor in ticks; the renderer derives frames from it. */
  animTicks: number;
}

export interface PacmanState extends Actor {
  /** Buffered turn request, applied at the first legal moment. */
  pendingDir: Direction;
  /** Ticks the pending request has been waiting; expires per the spec's window. */
  pendingAge: number;
}

export type GhostName = 'blinky' | 'pinky' | 'inky' | 'clyde';

export const GhostMode = {
  House: 'House',
  Scatter: 'Scatter',
  Chase: 'Chase',
  Frightened: 'Frightened',
  Eaten: 'Eaten',
} as const;
export type GhostMode = (typeof GhostMode)[keyof typeof GhostMode];

export interface GhostState extends Actor {
  name: GhostName;
  mode: GhostMode;
}

export interface MazeState {
  data: MazeData;
  /** One byte per tile: 0 none, 1 pellet, 2 power pellet. */
  pellets: Uint8Array;
  remaining: number;
}

export type GameEvent =
  | { type: 'PelletEaten'; x: number; y: number }
  | { type: 'PowerPelletEaten'; x: number; y: number }
  | { type: 'GhostEaten'; name: GhostName; points: number }
  | { type: 'Death' }
  | { type: 'LevelCleared' }
  | { type: 'ExtraLife' }
  /**
   * Emitted by every phase transition. The app reads it to reset the input
   * latch on respawn, and the audio director will read it for the Ready jingle
   * (product spec §4.7) — neither needs a callback out of the simulation.
   */
  | { type: 'PhaseChanged'; from: Phase; to: Phase };

export interface GameState {
  phase: Phase;
  /** Milliseconds remaining in timed phases. */
  phaseTimer: number;
  /**
   * Where `Paused` returns to. Pause suspends the phase underneath it rather
   * than replacing it, so a countdown paused two seconds in resumes two seconds
   * in rather than starting over.
   */
  resumePhase: Phase;
  level: number;
  score: number;
  lives: number;
  extraLifeAwarded: boolean;
  maze: MazeState;
  pacman: PacmanState;
  ghosts: readonly [GhostState, GhostState, GhostState, GhostState];
  fright: { active: boolean; msRemaining: number; ghostsEaten: number };
  /** Seeded PRNG state — a single uint32, so state stays cheap to clone. */
  rng: number;
  /**
   * Serial of the last input intent consumed. Held so a direction the player
   * keeps latched re-arms the turn buffer once, not on every tick — otherwise
   * the 400 ms expiry could never fire.
   */
  lastInputSerial: number;
  /** Drained each frame by the HUD and (later) audio. The sim never calls out. */
  events: GameEvent[];
}

/** What the input layer hands the simulation each tick (architecture §4). */
export interface InputSnapshot {
  dir: Direction;
  /** Incremented by the controller whenever a *new* intent is latched. */
  serial: number;
}

export function tileOf(subUnits: number): number {
  return Math.floor(subUnits / SUBTILE);
}

export function tileCentre(tile: number): number {
  return tile * SUBTILE + HALF_TILE;
}

export function isAtTileCentre(actor: Actor): boolean {
  return (
    (actor.x - HALF_TILE) % SUBTILE === 0 && (actor.y - HALF_TILE) % SUBTILE === 0
  );
}
