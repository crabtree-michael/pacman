import { SUBTILE } from './types';

/**
 * Per-level tuning (product spec §4.2, §4.3, §4.5).
 *
 * TODO(mechanics): fill in the full table — speeds per level band, frightened
 * duration shrinking to zero by level 19, Elroy thresholds, fruit type, and the
 * clamp from level 21 onwards. Only the level-1 row exists today, and only the
 * fields the skeleton actually reads.
 */

/**
 * Arcade reference speed is ~11 tiles per second; at a 60 Hz tick that is
 * `11 * 256 / 60` sub-units per tick.
 */
export const REFERENCE_SPEED = Math.round((11 * SUBTILE) / 60);

export interface LevelTuning {
  /** Fraction of reference speed, per the spec's 80/90/100% progression. */
  pacmanSpeedPct: number;
  ghostSpeedPct: number;
  frightMs: number;
}

const LEVEL_1: LevelTuning = {
  pacmanSpeedPct: 0.8,
  ghostSpeedPct: 0.75,
  frightMs: 6000,
};

export function tuningForLevel(_level: number): LevelTuning {
  return LEVEL_1;
}

export function speedFromPct(pct: number): number {
  return Math.max(1, Math.round(REFERENCE_SPEED * pct));
}
