import { describe, expect, it } from 'vitest';
import {
  MAX_TUNED_LEVEL,
  REFERENCE_SPEED,
  fruitForLevel,
  speedFromPct,
  tuningForLevel,
} from '../../src/sim/levels';

/**
 * The per-level tuning table (product spec §4.2, §4.3, §4.5).
 *
 * These pin the values the spec states outright and the shape of the curve
 * between them. The table is the one place a "the game got harder for no
 * reason" bug can hide, because nothing else reads these numbers back.
 */

describe('speeds', () => {
  it('follows the spec’s 80 / 90 / 100 per cent progression', () => {
    expect(tuningForLevel(1).pacmanSpeedPct).toBe(0.8);
    for (const level of [2, 3, 4]) {
      expect(tuningForLevel(level).pacmanSpeedPct).toBe(0.9);
    }
    for (const level of [5, 12, 21, 99]) {
      expect(tuningForLevel(level).pacmanSpeedPct).toBe(1);
    }
  });

  it('makes Pac-Man faster than the ghosts while powered (spec §4.2)', () => {
    for (const level of [1, 3, 8, 21]) {
      const tuning = tuningForLevel(level);
      expect(tuning.pacmanFrightSpeedPct).toBeGreaterThan(tuning.ghostFrightSpeedPct);
      expect(tuning.pacmanFrightSpeedPct).toBeGreaterThanOrEqual(tuning.pacmanSpeedPct);
    }
  });

  it('slows ghosts in the tunnel (spec §4.1)', () => {
    for (const level of [1, 3, 8, 21]) {
      const tuning = tuningForLevel(level);
      expect(tuning.ghostTunnelSpeedPct).toBeLessThan(tuning.ghostSpeedPct);
    }
  });

  it('converts a percentage to whole sub-units a tick', () => {
    expect(speedFromPct(1)).toBe(REFERENCE_SPEED);
    expect(Number.isInteger(speedFromPct(0.8))).toBe(true);
    // Never zero, however small the percentage — a stuck actor is worse than a
    // slow one.
    expect(speedFromPct(0)).toBe(1);
  });
});

describe('frightened duration', () => {
  it('starts at 6 seconds and is gone by level 19 (spec §4.3)', () => {
    expect(tuningForLevel(1).frightMs).toBe(6000);
    for (const level of [19, 20, 21, 40]) {
      expect(tuningForLevel(level).frightMs).toBe(0);
    }
  });

  it('trends downwards over the first half-dozen levels', () => {
    expect(tuningForLevel(2).frightMs).toBeLessThan(tuningForLevel(1).frightMs);
    expect(tuningForLevel(5).frightMs).toBeLessThan(tuningForLevel(2).frightMs);
  });
});

describe('Cruise Elroy thresholds', () => {
  it('trips the second stage later than the first, and rises with the level', () => {
    for (const level of [1, 5, 12, 21]) {
      const tuning = tuningForLevel(level);
      expect(tuning.elroy2Dots).toBeLessThan(tuning.elroy1Dots);
      expect(tuning.elroy2SpeedPct).toBeGreaterThan(tuning.elroy1SpeedPct);
    }
    expect(tuningForLevel(12).elroy1Dots).toBeGreaterThan(tuningForLevel(1).elroy1Dots);
  });
});

describe('fruit', () => {
  it('runs from the 100-point cherry to the 5000-point key (spec §4.4)', () => {
    expect(fruitForLevel(1)).toEqual({ kind: 'cherry', points: 100 });
    expect(fruitForLevel(13)).toEqual({ kind: 'key', points: 5000 });
    expect(fruitForLevel(50)).toEqual({ kind: 'key', points: 5000 });
  });

  it('never goes down in value', () => {
    let previous = 0;
    for (let level = 1; level <= 20; level++) {
      const { points } = fruitForLevel(level);
      expect(points).toBeGreaterThanOrEqual(previous);
      previous = points;
    }
  });
});

describe('the clamp past level 21', () => {
  it('reuses the hardest row for ever, since there is no winning (spec §4.5)', () => {
    const hardest = tuningForLevel(MAX_TUNED_LEVEL);
    for (const level of [22, 60, 255]) {
      expect(tuningForLevel(level)).toEqual(hardest);
    }
  });

  it('treats a nonsense level as level 1 rather than throwing', () => {
    expect(tuningForLevel(0)).toEqual(tuningForLevel(1));
    expect(tuningForLevel(-3)).toEqual(tuningForLevel(1));
  });
});
