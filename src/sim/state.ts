import type { MazeData, MazeSpawn } from '../data/maze-classic';
import { createMazeState } from './maze';
import { speedFromPct, tuningForLevel } from './levels';
import { DEFAULT_SEED } from './rng';
import {
  Direction,
  GhostMode,
  Phase,
  tileCentre,
  type GameState,
  type GhostName,
  type GhostState,
  type PacmanState,
} from './types';

/** Lives at the start of a game (product spec §4.5). */
export const STARTING_LIVES = 3;

const GHOST_ORDER: readonly GhostName[] = ['blinky', 'pinky', 'inky', 'clyde'];

function spawnAt(spawn: MazeSpawn): { x: number; y: number } {
  return { x: tileCentre(spawn.x), y: tileCentre(spawn.y) };
}

function spawnPacman(data: MazeData, level: number): PacmanState {
  return {
    ...spawnAt(data.spawns.pacman),
    dir: Direction.Left,
    speed: speedFromPct(tuningForLevel(level).pacmanSpeedPct),
    animTicks: 0,
    pendingDir: Direction.None,
    pendingAge: 0,
    stallTicks: 0,
  };
}

function spawnGhosts(data: MazeData, level: number): GameState['ghosts'] {
  const speed = speedFromPct(tuningForLevel(level).ghostSpeedPct);
  return GHOST_ORDER.map<GhostState>((name) => ({
    ...spawnAt(data.spawns[name]),
    dir: name === 'blinky' ? Direction.Left : Direction.Up,
    speed,
    animTicks: 0,
    name,
    mode: name === 'blinky' ? GhostMode.Scatter : GhostMode.House,
  })) as unknown as GameState['ghosts'];
}

/**
 * A fresh game, sitting at the boot gate.
 *
 * Nothing advances until the phase machine is told the assets have resolved
 * (architecture §5.3); see `sim/phases.ts`.
 */
export function createInitialState(
  data: MazeData,
  level = 1,
  seed = DEFAULT_SEED,
): GameState {
  return {
    phase: Phase.Boot,
    phaseTimer: 0,
    resumePhase: Phase.Playing,
    level,
    score: 0,
    lives: STARTING_LIVES,
    extraLifeAwarded: false,
    maze: createMazeState(data),
    pacman: spawnPacman(data, level),
    ghosts: spawnGhosts(data, level),
    fright: { active: false, msRemaining: 0, ghostsEaten: 0 },
    dotsEaten: 0,
    fruit: null,
    fruitsShown: 0,
    rng: seed,
    lastInputSerial: 0,
    events: [],
  };
}

/**
 * Put every actor back on its spawn tile — the reset shared by a level start
 * and a respawn after death.
 *
 * `lastInputSerial` is deliberately untouched: clearing it would make the
 * direction the player still has latched look like a fresh intent, and Pac-Man
 * would respawn already walking (product spec, open question 1). The input
 * controller's own latch is cleared app-side instead.
 */
export function resetActors(state: GameState): void {
  state.pacman = spawnPacman(state.maze.data, state.level);
  state.ghosts = spawnGhosts(state.maze.data, state.level);
  state.fright = { active: false, msRemaining: 0, ghostsEaten: 0 };
  // An uneaten fruit does not survive a death. Its dot count does, so the
  // second fruit still arrives on schedule (product spec §4.4).
  state.fruit = null;
}

/** Refill the board for `level` and send everyone home. Score and lives carry over. */
export function startLevel(state: GameState, level: number): void {
  state.level = level;
  state.maze = createMazeState(state.maze.data);
  state.dotsEaten = 0;
  state.fruitsShown = 0;
  resetActors(state);
}

/** Back to level 1 with a clean scoreboard, keeping the same board data. */
export function resetGame(state: GameState): void {
  state.score = 0;
  state.lives = STARTING_LIVES;
  state.extraLifeAwarded = false;
  startLevel(state, 1);
}

/**
 * Shallow-clone the mutable parts of the state.
 *
 * `step` works on a clone and returns it, so callers can hold on to the
 * previous state for render interpolation (architecture §2.4) without the
 * simulation having to be written in an immutable style throughout. The pellet
 * bitmap is copied lazily by `step` only on the ticks that change it.
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    maze: { ...state.maze },
    pacman: { ...state.pacman },
    ghosts: [
      { ...state.ghosts[0] },
      { ...state.ghosts[1] },
      { ...state.ghosts[2] },
      { ...state.ghosts[3] },
    ],
    fright: { ...state.fright },
    fruit: state.fruit === null ? null : { ...state.fruit },
    events: [],
  };
}
