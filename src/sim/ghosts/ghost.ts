import { speedFromPct, tuningForLevel } from '../levels';
import { isNoUpTile, isTunnelTile } from '../maze';
import { actorTile, canEnter, distanceToCentre, wrapPosition } from '../movement';
import { nextRng, rngBelow } from '../rng';
import {
  DIRECTION_DELTA,
  DIRECTION_PRIORITY,
  Direction,
  GhostMode,
  isAtTileCentre,
  opposite,
  type GameState,
  type GhostState,
  type Tile,
} from '../types';
import { HOUSE_SPEED_FACTOR, hasReachedHouse, moveInHouse } from './house';
import { distanceSquared, elroyStage, targetTile } from './targeting';

/**
 * The shared ghost movement engine (architecture §3.4 `ghost.ts` and §3.5,
 * product spec §4.3).
 *
 * All four ghosts run this one loop. At every tile centre a ghost picks the
 * exit that minimises straight-line distance to its target tile, never turning
 * back the way it came, never turning up at one of the four no-up tiles, and
 * breaking ties up → left → down → right. Nothing here knows which ghost it is
 * moving: the personalities are entirely in the target tile that
 * `targeting.ts` hands back, and the house is entirely in `house.ts`.
 *
 * Reproducing the tie-break order exactly is the difference between ghosts that
 * behave and ghosts that look right to someone who knows the game.
 */

/**
 * Eyes travel at 160% of the reference speed (product spec §4.3, "high speed").
 *
 * Not level-dependent, and faster than any ghost ever moves alive: the journey
 * home is meant to read as a punishment being served quickly, and the player
 * needs the ghost back in play before the power pellet's clock has run out or
 * the ladder stops being a risk worth taking.
 */
export const EYES_SPEED_PCT = 1.6;

/** Advance every ghost by one tick. */
export function updateGhosts(state: GameState): void {
  for (const ghost of state.ghosts) updateGhost(state, ghost);
}

function updateGhost(state: GameState, ghost: GhostState): void {
  ghost.speed = ghostSpeed(state, ghost);

  if (isHousebound(state, ghost)) moveInHouse(state, ghost);
  else moveOnGrid(state, ghost);

  ghost.animTicks++;
}

/** True when the house owns this ghost's movement rather than the board. */
function isHousebound(state: GameState, ghost: GhostState): boolean {
  if (ghost.mode === GhostMode.House || ghost.mode === GhostMode.Leaving) return true;
  return ghost.mode === GhostMode.Eaten && hasReachedHouse(state.maze.data, ghost);
}

/**
 * How fast this ghost moves this tick.
 *
 * Re-read every tick rather than stored, because four separate things move it:
 * the level, the mode, the tunnel, and Blinky's Elroy stage — and three of
 * those can change without the ghost doing anything at all.
 */
function ghostSpeed(state: GameState, ghost: GhostState): number {
  const maze = state.maze.data;
  const tuning = tuningForLevel(state.level);

  if (ghost.mode === GhostMode.Eaten) return speedFromPct(EYES_SPEED_PCT);
  if (ghost.mode === GhostMode.House || ghost.mode === GhostMode.Leaving) {
    return speedFromPct(tuning.ghostSpeedPct * HOUSE_SPEED_FACTOR);
  }

  let pct = tuning.ghostSpeedPct;
  if (ghost.mode === GhostMode.Frightened) {
    pct = tuning.ghostFrightSpeedPct;
  } else {
    // Cruise Elroy is Blinky's alone, and it stops while he is blue: a
    // frightened Elroy that outran Pac-Man would make the pellet worthless.
    const stage = elroyStage(state, ghost);
    if (stage === 1) pct = tuning.elroy1SpeedPct;
    else if (stage === 2) pct = tuning.elroy2SpeedPct;
  }

  const tile = actorTile(maze, ghost);
  if (isTunnelTile(maze, tile.col, tile.row)) {
    // The tunnel is the one place a ghost is slower than Pac-Man whatever the
    // level, which is what makes it an escape route (product spec §4.1).
    pct = Math.min(pct, tuning.ghostTunnelSpeedPct);
  }

  return speedFromPct(pct);
}

/**
 * Advance a ghost along the board, deciding afresh at every tile centre it
 * crosses.
 *
 * The loop, rather than one move per tick, is what keeps a decision from being
 * missed when a ghost's speed carries it past a centre — and what would keep
 * the engine honest if a future speed ever exceeded a tile per tick.
 */
function moveOnGrid(state: GameState, ghost: GhostState): void {
  const maze = state.maze.data;
  let remaining = ghost.speed;

  while (remaining > 0) {
    if (isAtTileCentre(ghost)) {
      // Eyes stop dead on the doorstep. The house takes over on the next tick,
      // from a position it can rely on being exact.
      if (ghost.mode === GhostMode.Eaten && hasReachedHouse(maze, ghost)) return;
      ghost.dir = chooseDirection(state, ghost);
    }

    const delta = DIRECTION_DELTA[ghost.dir];
    if (delta.x === 0 && delta.y === 0) return;

    const sign = delta.x !== 0 ? delta.x : delta.y;
    const axisPos = delta.x !== 0 ? ghost.x : ghost.y;
    const stepSize = Math.min(remaining, distanceToCentre(axisPos, sign));

    ghost.x += delta.x * stepSize;
    ghost.y += delta.y * stepSize;
    remaining -= stepSize;

    wrapPosition(maze, ghost);
  }
}

/**
 * Pick the exit to take from the tile the ghost is standing on.
 *
 * Ghosts never choose to turn round. The only reversals in the game are the
 * ones handed down from outside — a power pellet, or a scatter↔chase
 * transition — which is what makes those two events read as events.
 */
function chooseDirection(state: GameState, ghost: GhostState): Direction {
  const maze = state.maze.data;
  const tile = actorTile(maze, ghost);
  const back = opposite(ghost.dir);

  // The no-up tiles bind a ghost that is steering, not one running away or
  // running home: the arcade's restriction lives in the targeting routine,
  // which frightened ghosts and eyes never reach.
  const steering = ghost.mode === GhostMode.Scatter || ghost.mode === GhostMode.Chase;
  const noUp = steering && isNoUpTile(maze, tile.col, tile.row);

  const options: Direction[] = [];
  for (const dir of DIRECTION_PRIORITY) {
    if (dir === back) continue;
    if (dir === Direction.Up && noUp) continue;
    const delta = DIRECTION_DELTA[dir];
    if (!canEnter(maze, tile.col + delta.x, tile.row + delta.y)) continue;
    options.push(dir);
  }

  // A dead end. Only the tunnel's blind alleys and a no-up tile with nowhere
  // else to go can produce one, and turning round beats standing still.
  const first = options[0];
  if (first === undefined) return back;
  if (options.length === 1) return first;

  if (ghost.mode === GhostMode.Frightened) return randomOf(state, options);
  return nearest(state, ghost, tile, options);
}

/**
 * The exit that gets closest to the target tile.
 *
 * `options` arrives in up → left → down → right order and the comparison is
 * strict, so an equal distance keeps the earlier direction: that *is* the
 * arcade's tie-break, not an approximation of it.
 */
function nearest(
  state: GameState,
  ghost: GhostState,
  from: Tile,
  options: readonly Direction[],
): Direction {
  const target = targetTile(state, ghost);
  let best = options[0] as Direction;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const dir of options) {
    const delta = DIRECTION_DELTA[dir];
    const step = { col: from.col + delta.x, row: from.row + delta.y };
    const distance = distanceSquared(step, target);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = dir;
  }

  return best;
}

/**
 * A frightened ghost's coin flip, from the seeded PRNG (architecture §3.2).
 *
 * The state advances only when a choice is actually made, so the whole game
 * stays reproducible from its seed — which is what the replay tests rest on.
 */
function randomOf(state: GameState, options: readonly Direction[]): Direction {
  state.rng = nextRng(state.rng);
  return options[rngBelow(state.rng, options.length)] as Direction;
}
