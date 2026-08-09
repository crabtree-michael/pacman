import { describe, expect, it } from 'vitest';
import { CONTROL_ZONE_MIN, MIN_SUPPORTED_WIDTH, computeLayout } from '../../src/app/layout';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { MAX_DPR, computeViewport } from '../../src/render/viewport';

/**
 * Snapshot the layout and viewport maths across a device matrix (architecture
 * §9, "Layout").
 *
 * These snapshots pin *current* behaviour so an unintended change is visible in
 * a diff. They are not a ruling on the open question in the README's "Known
 * discrepancy" — when that is settled with the spec owner the numbers here are
 * expected to move, and the snapshot should be updated in the same commit.
 */

const DEVICES = [
  { name: 'iPhone 12/13/14 — 390x844', width: 390, height: 844, dpr: 3 },
  { name: 'iPhone 14 Pro Max — 430x932', width: 430, height: 932, dpr: 3 },
  { name: 'Pixel 5 — 393x851', width: 393, height: 851, dpr: 2.75 },
  { name: 'small Android — 360x640', width: 360, height: 640, dpr: 2 },
  { name: 'iPad — 768x1024', width: 768, height: 1024, dpr: 2 },
  { name: 'landscape phone — 844x390', width: 844, height: 390, dpr: 3 },
  { name: 'below the supported width — 300x640', width: 300, height: 640, dpr: 2 },
] as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

describe('layout matrix', () => {
  it('matches the recorded band maths', () => {
    const table = DEVICES.map((device) => {
      const metrics = computeLayout(
        device.width,
        device.height,
        MAZE_CLASSIC.cols,
        MAZE_CLASSIC.rows,
      );
      return {
        device: device.name,
        orientation: metrics.orientation,
        tooSmall: metrics.tooSmall,
        maze: `${round(metrics.mazeWidth)}x${round(metrics.mazeHeight)}`,
        controlZone: round(metrics.controlZone),
      };
    });
    expect(table).toMatchSnapshot();
  });

  it('never squeezes the control zone below its minimum', () => {
    for (const device of DEVICES) {
      const metrics = computeLayout(
        device.width,
        device.height,
        MAZE_CLASSIC.cols,
        MAZE_CLASSIC.rows,
      );
      expect(metrics.controlZone).toBeGreaterThanOrEqual(
        metrics.orientation === 'portrait' ? CONTROL_ZONE_MIN : 120,
      );
    }
  });

  it('flags screens narrower than the supported width', () => {
    const narrow = computeLayout(MIN_SUPPORTED_WIDTH - 1, 640, MAZE_CLASSIC.cols, MAZE_CLASSIC.rows);
    const wide = computeLayout(MIN_SUPPORTED_WIDTH, 640, MAZE_CLASSIC.cols, MAZE_CLASSIC.rows);
    expect(narrow.tooSmall).toBe(true);
    expect(wide.tooSmall).toBe(false);
  });

  it('keeps the maze within the space it was given', () => {
    for (const device of DEVICES) {
      const metrics = computeLayout(
        device.width,
        device.height,
        MAZE_CLASSIC.cols,
        MAZE_CLASSIC.rows,
      );
      expect(metrics.mazeWidth).toBeLessThanOrEqual(device.width);
      expect(metrics.mazeHeight).toBeLessThanOrEqual(device.height);
    }
  });
});

describe('viewport matrix', () => {
  it('matches the recorded tile fitting', () => {
    const table = DEVICES.map((device) => {
      const metrics = computeLayout(
        device.width,
        device.height,
        MAZE_CLASSIC.cols,
        MAZE_CLASSIC.rows,
      );
      const viewport = computeViewport(
        metrics.mazeWidth,
        metrics.mazeHeight,
        MAZE_CLASSIC.cols,
        MAZE_CLASSIC.rows,
        device.dpr,
      );
      return {
        device: device.name,
        dpr: viewport.dpr,
        tileSize: round(viewport.tileSize),
        origin: `${viewport.originX},${viewport.originY}`,
      };
    });
    expect(table).toMatchSnapshot();
  });

  it('caps the device pixel ratio at the fill-rate ceiling', () => {
    expect(computeViewport(390, 500, 28, 31, 4).dpr).toBe(MAX_DPR);
    expect(computeViewport(390, 500, 28, 31, 2).dpr).toBe(2);
  });

  it('falls back to a sane ratio when the browser reports none', () => {
    expect(computeViewport(390, 500, 28, 31, 0).dpr).toBe(1);
  });

  it('snaps the tile to whole device pixels when the cost is small', () => {
    const viewport = computeViewport(390, 500, 28, 31, 2);
    const deviceTile = viewport.tileSize * viewport.dpr;
    expect(Number.isInteger(Math.round(deviceTile * 1e6) / 1e6)).toBe(true);
  });
});
