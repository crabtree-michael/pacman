import { tuningForLevel } from '../levels';
import { actorTile } from '../movement';
import {
  DIRECTION_DELTA,
  Direction,
  GhostMode,
  type GameState,
  type GhostName,
  type GhostState,
  type Tile,
} from '../types';

/**
 * Where each ghost is aiming (product spec §4.3, architecture §3.4
 * `targeting.ts`).
 *
 * Every ghost runs the same movement engine and the same "take the exit that
 * gets me closest to my target tile" rule. The whole of their personality is
 * this file: four functions returning a tile. Blinky is on your back, Pinky
 * cuts you off, Inky is unpredictable because he depends on two entities at
 * once, and Clyde loses his nerve up close.
 *
 * Targets are plain tile coordinates and are allowed to sit outside the walls
 * or off the board entirely. Nothing ever walks to one; a target is only ever
 * the thing distances are measured to.
 */

/** Tiles ahead of Pac-Man that Pinky aims for. */
export const PINKY_LEAD = 4;
/** Tiles ahead of Pac-Man that Inky pivots around. */
export const INKY_PIVOT = 2;
/** Inside this many tiles, Clyde breaks off for his corner. */
export const CLYDE_RADIUS = 8;

/** Squared Euclidean distance in tiles. Squared because only order matters. */
export function distanceSquared(from: Tile, to: Tile): number {
  const dx = from.col - to.col;
  const dy = from.row - to.row;
  return dx * dx + dy * dy;
}

/**
 * `tiles` tiles ahead of a tile in a direction, *with the arcade's overflow
 * bug preserved* — facing up also shifts the target the same distance left.
 *
 * The original added the direction's row and column offsets in one 8-bit
 * operation and got the column wrong for up. The spec asks for the bug by name
 * (§4.3), and it is not a curiosity: it is why Pinky can be dodged by turning
 * up into her, and why Inky's target swings the way it does.
 */
function ahead(tile: Tile, dir: Direction, tiles: number): Tile {
  const delta = DIRECTION_DELTA[dir];
  return {
    col: tile.col + delta.x * tiles + (dir === Direction.Up ? -tiles : 0),
    row: tile.row + delta.y * tiles,
  };
}

/** The corner a ghost circles in scatter mode. */
export function scatterTarget(state: GameState, name: GhostName): Tile {
  const corner = state.maze.data.scatter[name];
  return { col: corner.x, row: corner.y };
}

/**
 * Cruise Elroy: 0, 1 or 2 (product spec §4.3).
 *
 * Blinky's late-level menace, and the reason a nearly-cleared board is the
 * tense part. Stage 1 speeds him up; stage 2 speeds him up again. Both stages
 * also pin him to chase targeting, so scatter stops being a rest.
 *
 * Only Blinky has stages; the argument is a ghost so callers need no special
 * case for the other three.
 */
export function elroyStage(state: GameState, ghost: GhostState): 0 | 1 | 2 {
  if (ghost.name !== 'blinky') return 0;
  const tuning = tuningForLevel(state.level);
  if (state.maze.remaining <= tuning.elroy2Dots) return 2;
  if (state.maze.remaining <= tuning.elroy1Dots) return 1;
  return 0;
}

/** Each ghost's chase target (product spec §4.3's table). */
export function chaseTarget(state: GameState, name: GhostName): Tile {
  const maze = state.maze.data;
  const pacman = actorTile(maze, state.pacman);

  switch (name) {
    case 'blinky':
      return pacman;

    case 'pinky':
      return ahead(pacman, state.pacman.dir, PINKY_LEAD);

    case 'inky': {
      // The vector from Blinky to two tiles ahead of Pac-Man, doubled. Inky is
      // the only ghost who needs another ghost to know where he is going, which
      // is why he reads as erratic: cornering Blinky moves Inky too.
      const pivot = ahead(pacman, state.pacman.dir, INKY_PIVOT);
      const blinky = actorTile(maze, state.ghosts[0]);
      return { col: pivot.col * 2 - blinky.col, row: pivot.row * 2 - blinky.row };
    }

    case 'clyde': {
      // Clyde is shy. Outside eight tiles he is Blinky; inside them he bolts
      // for his corner, which is why he seems to patrol the bottom left rather
      // than hunt. Squared distance, so nothing takes a square root.
      const clyde = actorTile(maze, state.ghosts[3]);
      const far = distanceSquared(clyde, pacman) > CLYDE_RADIUS * CLYDE_RADIUS;
      return far ? pacman : scatterTarget(state, 'clyde');
    }
  }
}

/**
 * The tile a ghost is currently steering towards.
 *
 * Frightened ghosts have no target — they choose at random — so this is only
 * asked for the modes that steer.
 */
export function targetTile(state: GameState, ghost: GhostState): Tile {
  if (ghost.mode === GhostMode.Eaten) {
    // Eyes go home the same way everyone else goes anywhere: by aiming at the
    // tile above the door and letting the movement engine find the route.
    const door = state.maze.data.house.door;
    return { col: door.x, row: door.y };
  }

  // Elroy overrides scatter, which is the whole of "permanent chase targeting"
  // (product spec §4.3): late in a level Blinky simply stops going home.
  if (ghost.mode === GhostMode.Chase || elroyStage(state, ghost) > 0) {
    return chaseTarget(state, ghost.name);
  }
  return scatterTarget(state, ghost.name);
}
