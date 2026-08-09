import { tuningForLevel } from '../levels';
import { isInsideHouse } from '../maze';
import { globalMode } from '../modes';
import { actorTile } from '../movement';
import {
  Direction,
  GhostMode,
  HALF_TILE,
  isAtTileCentre,
  tileCentre,
  type Actor,
  type GameState,
  type GhostName,
  type GhostState,
  type HouseState,
} from '../types';
import type { MazeData } from '../../data/maze-classic';

/**
 * The ghost house: who is let out and when, and how anyone gets through a door
 * the rest of the game treats as a wall (product spec §4.3, architecture §3.4
 * `house.ts`).
 *
 * Everything in here is scripted rather than steered. The interior is an open
 * room, not a corridor grid, so the tile-by-tile decision rule the board runs
 * on has nothing to decide in it; ghosts bob on the spot, slide to the door
 * column, and walk out. The moment a ghost is above the door it is back under
 * the ordinary rules and this module stops having an opinion.
 */

/** Who leaves in what order. Blinky is never in the queue — he starts outside. */
export const RELEASE_ORDER: readonly GhostName[] = ['pinky', 'inky', 'clyde'];

/** How far above and below the centre line a waiting ghost bobs. */
const BOB_AMPLITUDE = HALF_TILE;

/**
 * House speed, as a fraction of the level's ghost speed.
 *
 * The bob is a slow hover in the arcade and the walk out is no quicker. It
 * matters because it is dead time the player gets for free: a ghost released
 * on the dot counter is still three seconds from being a threat.
 */
export const HOUSE_SPEED_FACTOR = 0.5;

export function createHouseState(): HouseState {
  return { dots: 0, msSinceDot: 0 };
}

/**
 * Count a collectible against the house.
 *
 * The counter is the *house's*, not the level's: it restarts when the house
 * refills after a death, so the three ghosts that respawn have to be earned out
 * again rather than pouring straight back onto a board the player has already
 * half-cleared. (The arcade switches to a second, shorter counter at that
 * point. One counter with the level's own thresholds is the same idea with
 * fewer moving parts, and gives the player a slightly kinder respawn.)
 */
export function noteDotEaten(state: GameState): void {
  state.house.dots++;
  state.house.msSinceDot = 0;
}

/**
 * Let the next ghost out if the board has earned it, or if the player has
 * stopped eating for long enough (product spec §4.3).
 *
 * One ghost at a time and always in order, so a level that opens with every
 * threshold at zero still sends them out in single file rather than as a pack.
 */
export function updateHouse(state: GameState, stepMs: number): void {
  state.house.msSinceDot += stepMs;

  const waiting = nextInQueue(state);
  if (!waiting) return;

  const tuning = tuningForLevel(state.level);
  const earned = state.house.dots >= tuning.houseDots[waiting.name];
  // The thousandth-of-a-tick slack the phase clocks use, for the same reason:
  // 240 additions of 1000/60 come to a hair under 4000, and without it every
  // timeout in the game would be one tick long.
  const stalled = state.house.msSinceDot + stepMs / 1000 >= tuning.houseTimeoutMs;
  if (!earned && !stalled) return;

  waiting.mode = GhostMode.Leaving;
  // The timeout is a rolling one: releasing on it restarts the clock, so a
  // player who never eats again still empties the house one ghost per timeout.
  state.house.msSinceDot = 0;
}

function nextInQueue(state: GameState): GhostState | undefined {
  for (const name of RELEASE_ORDER) {
    const ghost = state.ghosts.find((candidate) => candidate.name === name);
    if (ghost?.mode === GhostMode.House) return ghost;
  }
  return undefined;
}

/** True once returning eyes are at the door or already inside the house. */
export function hasReachedHouse(maze: MazeData, ghost: GhostState): boolean {
  const tile = actorTile(maze, ghost);
  if (isInsideHouse(maze, tile.col, tile.row)) return true;
  const door = maze.house.door;
  return tile.col === door.x && tile.row === door.y && isAtTileCentre(ghost);
}

/**
 * Move a ghost that is waiting in the house, leaving it, or dropping back into
 * it as eyes. One tick's worth.
 */
export function moveInHouse(state: GameState, ghost: GhostState): void {
  switch (ghost.mode) {
    case GhostMode.House:
      bob(state.maze.data, ghost);
      return;
    case GhostMode.Eaten:
      revive(state, ghost);
      return;
    default:
      // `Leaving`. Nothing else ever gets in here: the modes that steer are
      // handled by the movement engine, and only eyes come back through the
      // door.
      walkOut(state, ghost);
  }
}

/** Hover on the spot, waiting to be let out. */
function bob(maze: MazeData, ghost: GhostState): void {
  const centre = tileCentre(maze.house.centre.y);
  if (ghost.dir !== Direction.Up && ghost.dir !== Direction.Down) ghost.dir = Direction.Up;

  ghost.y += ghost.dir === Direction.Up ? -ghost.speed : ghost.speed;

  // Clamped rather than reflected: bouncing the overshoot back would let the
  // turn-round point drift by a sub-unit or two per bob, and positions in this
  // game are exact by design.
  if (ghost.y <= centre - BOB_AMPLITUDE) {
    ghost.y = centre - BOB_AMPLITUDE;
    ghost.dir = Direction.Down;
  } else if (ghost.y >= centre + BOB_AMPLITUDE) {
    ghost.y = centre + BOB_AMPLITUDE;
    ghost.dir = Direction.Up;
  }
}

/** Slide to the door column, rise through the door, and join the game. */
function walkOut(state: GameState, ghost: GhostState): void {
  const maze = state.maze.data;
  const doorX = tileCentre(maze.house.door.x);
  const doorY = tileCentre(maze.house.door.y);

  moveTowards(ghost, doorX, doorY, ghost.speed);
  if (ghost.x !== doorX || ghost.y !== doorY) return;

  // Out. A ghost emerging mid-power-pellet emerges dangerous: the pellet
  // frightened the ghosts that were on the board when it was eaten, and this
  // one was not (product spec §4.3, and the arcade).
  ghost.mode = globalMode(state);
  // The arcade turns them left out of the door, every time. Keeping that is
  // most of why the opening seconds of a level look the way they do.
  ghost.dir = Direction.Left;
}

/** Drop the eyes to the revive spot, then send the ghost straight back out. */
function revive(state: GameState, ghost: GhostState): void {
  const maze = state.maze.data;
  const centre = maze.house.centre;
  const targetX = tileCentre(centre.x);
  const targetY = tileCentre(centre.y);

  moveTowards(ghost, targetX, targetY, ghost.speed);
  if (ghost.x !== targetX || ghost.y !== targetY) return;

  // No pause and no dot counter: an eaten ghost has already served its time as
  // eyes, and the spec has it "re-enter play in the current global mode" (§4.3)
  // rather than queue behind whoever is still waiting to be let out.
  ghost.mode = GhostMode.Leaving;
}

/**
 * Move `distance` sub-units towards a point, squaring up the column first.
 *
 * Axis at a time, and clamped at the target on each: every scripted move in
 * the house ends on an exact tile centre, which is what lets the ordinary
 * movement engine pick the ghost up again without a special case.
 */
function moveTowards(actor: Actor, targetX: number, targetY: number, distance: number): void {
  const leftover = stepAxis(actor, 'x', targetX, distance);
  if (leftover > 0) stepAxis(actor, 'y', targetY, leftover);
}

function stepAxis(actor: Actor, axis: 'x' | 'y', target: number, distance: number): number {
  const position = actor[axis];
  if (position === target) return distance;

  const gap = target - position;
  const move = Math.min(distance, Math.abs(gap));
  actor[axis] = position + Math.sign(gap) * move;
  actor.dir = facing(axis, gap);
  return distance - move;
}

function facing(axis: 'x' | 'y', gap: number): Direction {
  if (axis === 'x') return gap > 0 ? Direction.Right : Direction.Left;
  return gap > 0 ? Direction.Down : Direction.Up;
}
