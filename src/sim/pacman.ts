import { takeFruit } from './fruit';
import { speedFromPct, tuningForLevel } from './levels';
import { Pellet, takePelletAt } from './maze';
import { actorTile, movePacman } from './movement';
import { startFright } from './modes';
import {
  PELLET_POINTS,
  POWER_PELLET_POINTS,
  award,
  ghostPoints,
} from './scoring';
import { GhostMode, type GameState } from './types';

/**
 * The player update: move, eat, and settle what running into a ghost means
 * (architecture §3.4 `pacman.ts`, product spec §4.2 and §4.4).
 */

/**
 * Ticks of movement eating costs (product spec §4.2).
 *
 * The spec names one frame for a pellet and is silent on the power pellet; the
 * arcade charges three, and that pause is part of why a power pellet is worth
 * timing rather than grabbing on sight. Both matter because they change the
 * distance a ghost closes while Pac-Man chews, not because they are visible.
 */
export const PELLET_STALL_TICKS = 1;
export const POWER_PELLET_STALL_TICKS = 3;

/**
 * Advance Pac-Man one tick and collect whatever he lands on.
 *
 * Speed is re-read every tick rather than only on spawn, because a power
 * pellet changes it mid-level: the spec has Pac-Man slightly faster than the
 * ghosts for as long as one is running (§4.2).
 */
export function updatePacman(state: GameState, stepMs: number): void {
  const pacman = state.pacman;
  const tuning = tuningForLevel(state.level);
  pacman.speed = speedFromPct(
    state.fright.active ? tuning.pacmanFrightSpeedPct : tuning.pacmanSpeedPct,
  );

  if (pacman.stallTicks > 0) {
    // Frozen mid-chew. The turn buffer's clock stops with him: its window
    // exists to expire requests that outlived their junction, and no junction
    // goes past while he is standing still.
    pacman.stallTicks--;
  } else {
    movePacman(state.maze.data, pacman, stepMs);
  }

  const { col, row } = actorTile(state.maze.data, pacman);
  eat(state, col, row);
  takeFruit(state, col, row);
}

function eat(state: GameState, col: number, row: number): void {
  const pellet = takePelletAt(state.maze, col, row);
  if (pellet === Pellet.None) return;

  state.dotsEaten++;

  if (pellet === Pellet.Power) {
    award(state, POWER_PELLET_POINTS);
    state.pacman.stallTicks = POWER_PELLET_STALL_TICKS;
    state.events.push({ type: 'PowerPelletEaten', x: col, y: row });
    startFright(state);
    return;
  }

  award(state, PELLET_POINTS);
  state.pacman.stallTicks = PELLET_STALL_TICKS;
  state.events.push({ type: 'PelletEaten', x: col, y: row });
}

/**
 * Resolve Pac-Man sharing a tile with a ghost. Returns true if he was caught.
 *
 * Tile equality rather than a distance test, which is what the arcade does and
 * what makes the famous pass-through possible: two actors that swap tiles in
 * one tick cross without touching. Reproducing that is the point — a distance
 * test would quietly close a gap players have exploited for forty years.
 *
 * Ghosts already eaten are eyes, and ghosts in the house are unreachable, so
 * neither is contact.
 */
export function resolveGhostContact(state: GameState): boolean {
  const pacman = actorTile(state.maze.data, state.pacman);

  for (const ghost of state.ghosts) {
    if (ghost.mode === GhostMode.Eaten || ghost.mode === GhostMode.House) continue;

    const tile = actorTile(state.maze.data, ghost);
    if (tile.col !== pacman.col || tile.row !== pacman.row) continue;

    if (ghost.mode !== GhostMode.Frightened) return true;

    const points = ghostPoints(state.fright.ghostsEaten);
    state.fright.ghostsEaten++;
    award(state, points);
    // TODO(ghosts): the eyes' journey home and the ~1 s freeze while the score
    // bubble shows land with the ghost ticket; the ghost holds where it was
    // eaten until then, harmless because eyes are not contact.
    ghost.mode = GhostMode.Eaten;
    state.events.push({ type: 'GhostEaten', name: ghost.name, points });
  }

  return false;
}
