import { SUBTILE, type FruitKind } from './types';

/**
 * Per-level tuning (product spec §4.2, §4.3, §4.5).
 *
 * The spec points at "the speed table in the architecture doc's tuning
 * appendix", which does not exist. The numbers below are the arcade's, which
 * is what the spec's own prose quotes: Pac-Man at 80% on level 1, 90% on 2–4
 * and 100% from 5; frightened time 6 s at level 1 falling to 0 from 19. Where
 * the spec states a value it wins; where it is silent the arcade does.
 *
 * Everything here is banded rather than one row per level, because that is the
 * shape of the real table — three speed bands, a handful of fright durations,
 * and thresholds that step every few levels. A 21-row literal would hide that
 * structure behind 200 lines of numbers.
 */

/**
 * Arcade reference speed is ~11 tiles per second; at a 60 Hz tick that is
 * `11 * 256 / 60` sub-units per tick.
 */
export const REFERENCE_SPEED = Math.round((11 * SUBTILE) / 60);

/**
 * The table stops changing here and every level beyond reuses this row
 * (product spec §4.5) — there is no "win the game" state.
 */
export const MAX_TUNED_LEVEL = 21;

export interface Fruit {
  kind: FruitKind;
  /** Product spec §4.4: 100 → 5000 depending on level. */
  points: number;
}

export interface LevelTuning {
  /** Fraction of reference speed, per the spec's 80/90/100% progression. */
  pacmanSpeedPct: number;
  /** Pac-Man is slightly faster than the ghosts while powered (spec §4.2). */
  pacmanFrightSpeedPct: number;
  ghostSpeedPct: number;
  ghostFrightSpeedPct: number;
  /** Ghosts move at reduced speed inside the side tunnel (spec §4.1). */
  ghostTunnelSpeedPct: number;
  /** Frightened duration; 0 from level 19, where power pellets stop frightening. */
  frightMs: number;
  /** Remaining-pellet thresholds for Blinky's two Cruise Elroy stages (spec §4.3). */
  elroy1Dots: number;
  elroy1SpeedPct: number;
  elroy2Dots: number;
  elroy2SpeedPct: number;
  fruit: Fruit;
}

interface SpeedBand {
  pacmanSpeedPct: number;
  pacmanFrightSpeedPct: number;
  ghostSpeedPct: number;
  ghostFrightSpeedPct: number;
  ghostTunnelSpeedPct: number;
  elroy1SpeedPct: number;
  elroy2SpeedPct: number;
}

/** Level 1 / levels 2–4 / levels 5 and up — the spec's three bands. */
const SPEED_BANDS: readonly [SpeedBand, SpeedBand, SpeedBand] = [
  {
    pacmanSpeedPct: 0.8,
    pacmanFrightSpeedPct: 0.9,
    ghostSpeedPct: 0.75,
    ghostFrightSpeedPct: 0.5,
    ghostTunnelSpeedPct: 0.4,
    elroy1SpeedPct: 0.8,
    elroy2SpeedPct: 0.85,
  },
  {
    pacmanSpeedPct: 0.9,
    pacmanFrightSpeedPct: 0.95,
    ghostSpeedPct: 0.85,
    ghostFrightSpeedPct: 0.55,
    ghostTunnelSpeedPct: 0.45,
    elroy1SpeedPct: 0.9,
    elroy2SpeedPct: 0.95,
  },
  {
    pacmanSpeedPct: 1,
    pacmanFrightSpeedPct: 1,
    ghostSpeedPct: 0.95,
    ghostFrightSpeedPct: 0.6,
    ghostTunnelSpeedPct: 0.5,
    elroy1SpeedPct: 1,
    elroy2SpeedPct: 1.05,
  },
];

/**
 * Frightened seconds by level, level 1 first.
 *
 * Not monotonic, and deliberately so: the arcade's table dips to 1 s at level 9
 * and back to 5 s at 10, and those two levels are famous breathing room. Both
 * of the spec's stated anchors hold — 6 s at level 1, and nothing from 19 on.
 */
const FRIGHT_SECONDS: readonly number[] = [
  6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1, 0,
];

/** `[stage 1, stage 2]` remaining-pellet thresholds, level 1 first. */
const ELROY_DOTS: readonly (readonly [number, number])[] = [
  [20, 10],
  [30, 15],
  [40, 20],
  [40, 20],
  [40, 20],
  [50, 25],
  [50, 25],
  [50, 25],
  [60, 30],
  [60, 30],
  [60, 30],
  [80, 40],
  [80, 40],
  [80, 40],
  [100, 50],
  [100, 50],
  [100, 50],
  [100, 50],
  [120, 60],
  [120, 60],
  [120, 60],
];

/** Bonus fruit by level, level 1 first; level 13 and up all take the key. */
const FRUITS: readonly Fruit[] = [
  { kind: 'cherry', points: 100 },
  { kind: 'strawberry', points: 300 },
  { kind: 'orange', points: 500 },
  { kind: 'orange', points: 500 },
  { kind: 'apple', points: 700 },
  { kind: 'apple', points: 700 },
  { kind: 'melon', points: 1000 },
  { kind: 'melon', points: 1000 },
  { kind: 'galaxian', points: 2000 },
  { kind: 'galaxian', points: 2000 },
  { kind: 'bell', points: 3000 },
  { kind: 'bell', points: 3000 },
  { kind: 'key', points: 5000 },
];

function last<T>(table: readonly T[]): T {
  return table[table.length - 1] as T;
}

/** Clamp to a 1-based row of `table`, saturating at both ends. */
function rowFor<T>(table: readonly T[], level: number): T {
  if (level <= 1) return table[0] as T;
  return table[Math.min(level, table.length) - 1] ?? last(table);
}

function speedBand(level: number): SpeedBand {
  if (level <= 1) return SPEED_BANDS[0];
  if (level <= 4) return SPEED_BANDS[1];
  return SPEED_BANDS[2];
}

export function fruitForLevel(level: number): Fruit {
  return rowFor(FRUITS, Math.max(1, Math.floor(level)));
}

export function tuningForLevel(level: number): LevelTuning {
  const clamped = Math.min(Math.max(1, Math.floor(level)), MAX_TUNED_LEVEL);
  const band = speedBand(clamped);
  const [elroy1Dots, elroy2Dots] = rowFor(ELROY_DOTS, clamped);

  return {
    ...band,
    frightMs: rowFor(FRIGHT_SECONDS, clamped) * 1000,
    elroy1Dots,
    elroy2Dots,
    fruit: fruitForLevel(clamped),
  };
}

export function speedFromPct(pct: number): number {
  return Math.max(1, Math.round(REFERENCE_SPEED * pct));
}
