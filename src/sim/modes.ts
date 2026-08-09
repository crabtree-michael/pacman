import { tuningForLevel } from './levels';
import { opposite, GhostMode, type GameState, type GhostState } from './types';

/**
 * The frightened timer (product spec §4.3, architecture §3.4 `modes.ts`).
 *
 * The scatter/chase scheduler that shares this module is `TODO(ghosts)`: it
 * decides where ghosts aim, which is the ghost ticket's whole subject. What
 * lives here now is the half a power pellet drives, which is player-facing and
 * has to work before a ghost ever chases anyone.
 */

/**
 * How long frightened ghosts flash before the mode expires (product spec §4.3).
 *
 * Read by the renderer, not the simulation — the flash is a warning, not a
 * behaviour change. On the late levels whose frightened time is shorter than
 * this, the ghosts flash for all of it, which is the right warning to give.
 */
export const FRIGHT_FLASH_MS = 2000;

/** True while frightened ghosts should be drawn flashing. */
export function isFrightFlashing(state: GameState): boolean {
  return state.fright.active && state.fright.msRemaining <= FRIGHT_FLASH_MS;
}

/** Ghosts that a power pellet turns around: out on the board and still chaseable. */
function isFrightenable(ghost: GhostState): boolean {
  return ghost.mode === GhostMode.Scatter || ghost.mode === GhostMode.Chase;
}

/**
 * Start (or restart) frightened mode.
 *
 * A second power pellet eaten while the first is still running replaces the
 * timer and resets the ghost multiplier, exactly as the arcade does — the
 * remaining time is not added on.
 *
 * From level 19 the tuning table gives no frightened time at all. The ghosts
 * still reverse, because the reversal is the pellet's doing and not the
 * mode's; they simply never turn blue.
 */
export function startFright(state: GameState): void {
  const frightMs = tuningForLevel(state.level).frightMs;

  for (const ghost of state.ghosts) {
    if (!isFrightenable(ghost)) continue;
    ghost.dir = opposite(ghost.dir);
    if (frightMs > 0) ghost.mode = GhostMode.Frightened;
  }

  if (frightMs <= 0) {
    state.fright = { active: false, msRemaining: 0, ghostsEaten: 0 };
    return;
  }
  state.fright = { active: true, msRemaining: frightMs, ghostsEaten: 0 };
}

/**
 * Tick the frightened clock down and hand the board back when it runs out.
 *
 * TODO(ghosts): expiring ghosts return to `Scatter` because there is no global
 * scatter/chase cursor yet. When the scheduler lands they go back to whatever
 * it currently says, which is what the spec means by "frightened time does not
 * advance the global timer" (§4.3).
 */
export function updateFright(state: GameState, stepMs: number): void {
  if (!state.fright.active) return;

  state.fright.msRemaining -= stepMs;
  if (state.fright.msRemaining > stepMs / 1000) return;

  state.fright = { active: false, msRemaining: 0, ghostsEaten: 0 };
  for (const ghost of state.ghosts) {
    if (ghost.mode === GhostMode.Frightened) ghost.mode = GhostMode.Scatter;
  }
}
