import { tuningForLevel } from './levels';
import {
  opposite,
  GhostMode,
  type GameState,
  type GhostState,
  type ModeScheduler,
} from './types';

/**
 * What mode the ghosts are in and when it changes (product spec §4.3,
 * architecture §3.4 `modes.ts`).
 *
 * Two clocks live here and they are deliberately not the same clock. The
 * scatter/chase scheduler is a global cursor through a fixed per-level
 * schedule; the frightened timer is started by a power pellet and suspends the
 * scheduler while it runs, which is what the spec means by "frightened time
 * does not advance the global timer".
 *
 * Where ghosts *aim* in each mode is `ghosts/targeting.ts`. This module only
 * says which mode they are in.
 */

/** The last entry in every schedule: chase, until the level ends. */
const FOREVER = Number.POSITIVE_INFINITY;

/**
 * Scatter and chase durations in milliseconds, alternating and starting with
 * scatter, so an even index is scatter and an odd one chase.
 *
 * Level 1 is the spec's own schedule (§4.3). Levels 2 and up are the arcade's,
 * on this project's standing rule that where the spec is silent the original
 * decides — including the two entries that look like typos and are not: a
 * seventeen-minute chase, ended by a scatter one frame long. That single frame
 * exists purely to force the reversal every scatter↔chase transition carries,
 * and it is the reason a late-level ghost train suddenly turns around after
 * what felt like permanent chase.
 */
const SCHEDULES: readonly (readonly number[])[] = [
  [7000, 20000, 7000, 20000, 5000, 20000, 5000, FOREVER],
  [7000, 20000, 7000, 20000, 5000, 1033000, 1000 / 60, FOREVER],
  [5000, 20000, 5000, 20000, 5000, 1037000, 1000 / 60, FOREVER],
];

/** Level 1 / levels 2–4 / levels 5 and up, matching the speed bands. */
function scheduleFor(level: number): readonly number[] {
  if (level <= 1) return SCHEDULES[0] as readonly number[];
  if (level <= 4) return SCHEDULES[1] as readonly number[];
  return SCHEDULES[2] as readonly number[];
}

/** A cursor at the top of `level`'s schedule — a level always opens scattering. */
export function createScheduler(level: number): ModeScheduler {
  return { index: 0, msRemaining: scheduleFor(level)[0] as number };
}

/** Scatter or Chase, according to where a cursor has got to. */
export function modeAt(scheduler: ModeScheduler): GhostMode {
  return scheduler.index % 2 === 0 ? GhostMode.Scatter : GhostMode.Chase;
}

/** The mode the ghosts on the board are patrolling in right now. */
export function globalMode(state: GameState): GhostMode {
  return modeAt(state.modeTimer);
}

/** Ghosts the alternation applies to: out on the board and not frightened. */
function isPatrolling(ghost: GhostState): boolean {
  return ghost.mode === GhostMode.Scatter || ghost.mode === GhostMode.Chase;
}

/**
 * Advance the scatter/chase cursor.
 *
 * Frightened time is not deducted at all — the cursor stands still until the
 * blue wears off, so a power pellet eaten two seconds into a scatter leaves
 * five seconds of scatter waiting on the other side (product spec §4.3).
 */
export function updateModes(state: GameState, stepMs: number): void {
  if (state.fright.active) return;

  const timer = state.modeTimer;
  if (timer.msRemaining === FOREVER) return;

  timer.msRemaining -= stepMs;
  // The same thousandth-of-a-tick slack the phase clocks use: repeated float
  // subtraction leaves a sliver behind, and a `> 0` test would stretch every
  // scatter by one tick.
  if (timer.msRemaining > stepMs / 1000) return;

  timer.index++;
  timer.msRemaining = scheduleFor(state.level)[timer.index] ?? FOREVER;

  // Every transition turns the loose ghosts around (product spec §4.3). It is
  // the reversal, not the new target, that a player feels: a ghost two tiles
  // behind is suddenly a ghost two tiles ahead.
  const mode = globalMode(state);
  for (const ghost of state.ghosts) {
    if (!isPatrolling(ghost)) continue;
    ghost.dir = opposite(ghost.dir);
    ghost.mode = mode;
  }
}

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
 *
 * Ghosts in the house, on their way out of it, or already eyes are untouched,
 * which is the arcade's rule too: a ghost that emerges mid-pellet comes out
 * dangerous, and the player who assumed otherwise learns something.
 */
export function startFright(state: GameState): void {
  const frightMs = tuningForLevel(state.level).frightMs;

  for (const ghost of state.ghosts) {
    if (!isPatrolling(ghost)) continue;
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
 * Ghosts return to whatever the global cursor says *now*, not to the mode they
 * were frightened out of. The cursor has not moved in the meantime, so on a
 * short pellet those are the same thing; on one eaten in the last second of a
 * scatter they are not, and the arcade's answer is the cursor's.
 */
export function updateFright(state: GameState, stepMs: number): void {
  if (!state.fright.active) return;

  state.fright.msRemaining -= stepMs;
  if (state.fright.msRemaining > stepMs / 1000) return;

  state.fright = { active: false, msRemaining: 0, ghostsEaten: 0 };
  const mode = globalMode(state);
  for (const ghost of state.ghosts) {
    if (ghost.mode === GhostMode.Frightened) ghost.mode = mode;
  }
}
