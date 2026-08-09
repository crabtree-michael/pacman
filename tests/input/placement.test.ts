import { describe, expect, it } from 'vitest';
import {
  JOYSTICK_INSET_PX,
  restPosition,
  type JoystickPlacement,
} from '../../src/input/joystick-view';
import { JOYSTICK_BASE_PX } from '../../src/input/joystick';

/**
 * Where the ring rests (product spec §2.1, §3.4).
 *
 * This is the half of `joystick-view.ts` that has no DOM in it. It used to be a
 * `getBoundingClientRect` read, which could only be checked in a browser and
 * only after the styles it depended on had been applied; as arithmetic it is
 * checkable here, at every size, for free.
 */

const PHONE: JoystickPlacement = { tablet: false, orientation: 'portrait', handedness: 'left' };
const TABLET: JoystickPlacement = { tablet: true, orientation: 'portrait', handedness: 'left' };

/** How far a ring centred at `point` is from each edge of the zone. */
function clearances(
  point: { x: number; y: number },
  zone: { width: number; height: number },
  size: number,
): { left: number; right: number; top: number; bottom: number } {
  const half = size / 2;
  return {
    left: point.x - half,
    right: zone.width - (point.x + half),
    top: point.y - half,
    bottom: zone.height - (point.y + half),
  };
}

describe('restPosition', () => {
  it('centres the ring in the band on a phone', () => {
    const zone = { width: 390, height: 300 };
    expect(restPosition(zone, JOYSTICK_BASE_PX, PHONE)).toEqual({ x: 195, y: 150 });
  });

  it('corners it bottom-left on a portrait tablet', () => {
    const zone = { width: 768, height: 364 };
    const size = 160;
    const rest = restPosition(zone, size, TABLET);

    expect(rest.x).toBe(JOYSTICK_INSET_PX + size / 2);
    expect(rest.y).toBe(zone.height - JOYSTICK_INSET_PX - size / 2);
  });

  it('mirrors the corner for a right-handed player', () => {
    const zone = { width: 768, height: 364 };
    const size = 160;
    const left = restPosition(zone, size, TABLET);
    const right = restPosition(zone, size, { ...TABLET, handedness: 'right' });

    expect(right.y).toBe(left.y);
    // Same distance from its own edge, on the other side.
    expect(zone.width - right.x).toBe(left.x);
  });

  it('centres in the gutter in landscape, tablet or not', () => {
    const zone = { width: 176, height: 768 };
    const landscape: JoystickPlacement = { ...TABLET, orientation: 'landscape' };

    // The gutter is already a thumb-width column; a corner in it helps nobody.
    expect(restPosition(zone, 128, landscape)).toEqual({ x: 88, y: 384 });
  });

  it('keeps the whole ring inside the zone at every supported size', () => {
    const sizes = [
      { width: 320, height: 180 },
      { width: 360, height: 180 },
      { width: 390, height: 332 },
      { width: 430, height: 372 },
      { width: 768, height: 364 },
      { width: 1024, height: 700 },
      { width: 150, height: 296 }, // Landscape gutter on a 568x320 phone.
      { width: 176, height: 744 },
    ];

    for (const zone of sizes) {
      const size = Math.min(JOYSTICK_BASE_PX, zone.width, zone.height);
      for (const placement of [
        PHONE,
        TABLET,
        { ...TABLET, handedness: 'right' } as JoystickPlacement,
        { ...TABLET, orientation: 'landscape' } as JoystickPlacement,
      ]) {
        const gaps = clearances(restPosition(zone, size, placement), zone, size);
        const where = `${zone.width}x${zone.height} ${placement.orientation} tablet=${placement.tablet}`;

        expect(gaps.left, `${where}: ring off the left`).toBeGreaterThanOrEqual(0);
        expect(gaps.right, `${where}: ring off the right`).toBeGreaterThanOrEqual(0);
        expect(gaps.top, `${where}: ring off the top`).toBeGreaterThanOrEqual(0);
        expect(gaps.bottom, `${where}: ring off the bottom`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives up the inset rather than the ring when the band is too shallow', () => {
    // A band only 12 px taller than the ring cannot honour a 24 px inset too.
    const zone = { width: 700, height: 140 };
    const rest = restPosition(zone, 128, TABLET);
    const gaps = clearances(rest, zone, 128);

    // Containment wins: the ring stays whole, and the inset is what gives.
    expect(gaps.top).toBeGreaterThanOrEqual(0);
    expect(gaps.bottom).toBeGreaterThanOrEqual(0);
    expect(rest.y).toBe(64);
  });
});
