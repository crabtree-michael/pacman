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

/** Countdown shown before play begins (product spec §4.6). */
export const READY_MS = 3000;

const GHOST_ORDER: readonly GhostName[] = ['blinky', 'pinky', 'inky', 'clyde'];

function spawnAt(spawn: MazeSpawn): { x: number; y: number } {
  return { x: tileCentre(spawn.x), y: tileCentre(spawn.y) };
}

export function createInitialState(
  data: MazeData,
  level = 1,
  seed = DEFAULT_SEED,
): GameState {
  const tuning = tuningForLevel(level);

  const pacman: PacmanState = {
    ...spawnAt(data.spawns.pacman),
    dir: Direction.Left,
    speed: speedFromPct(tuning.pacmanSpeedPct),
    animTicks: 0,
    pendingDir: Direction.None,
    pendingAge: 0,
  };

  const ghosts = GHOST_ORDER.map<GhostState>((name) => ({
    ...spawnAt(data.spawns[name]),
    dir: name === 'blinky' ? Direction.Left : Direction.Up,
    speed: speedFromPct(tuning.ghostSpeedPct),
    animTicks: 0,
    name,
    mode: name === 'blinky' ? GhostMode.Scatter : GhostMode.House,
  })) as unknown as GameState['ghosts'];

  return {
    phase: Phase.Ready,
    phaseTimer: READY_MS,
    level,
    score: 0,
    lives: 3,
    extraLifeAwarded: false,
    maze: createMazeState(data),
    pacman,
    ghosts,
    fright: { active: false, msRemaining: 0, ghostsEaten: 0 },
    rng: seed,
    lastInputSerial: 0,
    events: [],
  };
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
    events: [],
  };
}
