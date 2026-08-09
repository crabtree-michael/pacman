import type { MazeData } from '../data/maze-classic';
import { isWall, wrapCol } from './maze';
import {
  DIRECTION_DELTA,
  Direction,
  HALF_TILE,
  SUBTILE,
  isAtTileCentre,
  opposite,
  tileOf,
  type Actor,
  type PacmanState,
} from './types';

/**
 * Grid-locked motion — the routine that defines how the game feels
 * (architecture §3.5, product spec §3.2 and §4.2).
 */

/** Turn requests expire after this long if they never become legal. */
export const PENDING_TTL_MS = 400;

/**
 * How far before a tile centre Pac-Man may begin a turn.
 *
 * TODO(mechanics): implement cornering. The constant is here so the value is
 * discoverable and tunable from day one, but the diagonal movement it implies
 * belongs with the movement ticket. Ghosts never corner.
 */
export const CORNER_TOLERANCE = 0;

/** Distance in sub-units from `pos` to the next tile centre along `sign`. */
function distanceToCentre(pos: number, sign: number): number {
  const offset = (((pos - HALF_TILE) % SUBTILE) + SUBTILE) % SUBTILE;
  if (offset === 0) return SUBTILE;
  return sign > 0 ? SUBTILE - offset : offset;
}

export function canEnter(maze: MazeData, col: number, row: number): boolean {
  return !isWall(maze, col, row);
}

/** True if `actor` may turn to `dir` from the tile it is standing on. */
export function isTurnLegal(maze: MazeData, actor: Actor, dir: Direction): boolean {
  if (dir === Direction.None) return false;
  const delta = DIRECTION_DELTA[dir];
  return canEnter(maze, tileOf(actor.x) + delta.x, tileOf(actor.y) + delta.y);
}

/** Keep an actor inside the board, wrapping horizontally through the tunnel. */
function wrapPosition(maze: MazeData, actor: Actor): void {
  const span = maze.cols * SUBTILE;
  if (actor.x < 0) actor.x += span;
  else if (actor.x >= span) actor.x -= span;
}

/**
 * Advance Pac-Man by one simulation tick.
 *
 * Mutates `pacman` — callers pass a copy that belongs to the next state, so
 * `step` as a whole stays pure.
 */
export function movePacman(maze: MazeData, pacman: PacmanState, stepMs: number): void {
  // Reversal is legal anywhere along a corridor, so it never waits for a
  // centre (product spec §3.2).
  if (pacman.pendingDir !== Direction.None && pacman.pendingDir === opposite(pacman.dir)) {
    pacman.dir = pacman.pendingDir;
    pacman.pendingDir = Direction.None;
    pacman.pendingAge = 0;
  }

  if (pacman.pendingDir !== Direction.None) {
    pacman.pendingAge += stepMs;
    if (pacman.pendingAge >= PENDING_TTL_MS) {
      // A stale flick must not fire at a junction three corridors later.
      pacman.pendingDir = Direction.None;
      pacman.pendingAge = 0;
    }
  }

  let remaining = pacman.speed;
  while (remaining > 0) {
    if (isAtTileCentre(pacman)) {
      if (pacman.pendingDir !== Direction.None && isTurnLegal(maze, pacman, pacman.pendingDir)) {
        pacman.dir = pacman.pendingDir;
        pacman.pendingDir = Direction.None;
        pacman.pendingAge = 0;
      }
      if (!isTurnLegal(maze, pacman, pacman.dir)) {
        return; // Stopped against a wall; hold here until a legal turn arrives.
      }
    }

    const delta = DIRECTION_DELTA[pacman.dir];
    if (delta.x === 0 && delta.y === 0) return;

    const sign = delta.x !== 0 ? delta.x : delta.y;
    const axisPos = delta.x !== 0 ? pacman.x : pacman.y;
    const stepSize = Math.min(remaining, distanceToCentre(axisPos, sign));

    pacman.x += delta.x * stepSize;
    pacman.y += delta.y * stepSize;
    remaining -= stepSize;

    wrapPosition(maze, pacman);
  }

  pacman.animTicks++;
}

/**
 * Advance a ghost by one tick.
 *
 * TODO(ghosts): ghosts currently hold position. The shared movement engine
 * lands with the ghost ticket, where at each tile centre a ghost picks the exit
 * minimising straight-line distance to its target tile — never reversing, never
 * turning up on a no-up tile, tie-broken up → left → down → right.
 */
export function moveGhost(_maze: MazeData, _ghost: Actor, _stepMs: number): void {
  // Intentionally inert — see the TODO above.
}

/** Tile currently occupied, tunnel-wrapped. */
export function actorTile(maze: MazeData, actor: Actor): { col: number; row: number } {
  return { col: wrapCol(maze, tileOf(actor.x)), row: tileOf(actor.y) };
}
