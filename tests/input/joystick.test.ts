import { describe, expect, it } from 'vitest';
import {
  ANGULAR_DEAD_ZONE_DEG,
  DIRECTION_ARC_HALF_DEG,
  VirtualJoystick,
  snapToCardinal,
} from '../../src/input/joystick';
import { Direction } from '../../src/sim/types';

/**
 * Synthetic pointer sequences asserting the emitted direction (architecture §9,
 * "Input"). `joystick.ts` is deliberately DOM-free, so this runs under plain
 * Node; the DOM half lives in the Playwright smoke test.
 */

/** A drag vector of length 100 at `deg` clockwise from due right (screen axes). */
function drag(deg: number): { dx: number; dy: number } {
  const radians = (deg * Math.PI) / 180;
  return { dx: 100 * Math.cos(radians), dy: 100 * Math.sin(radians) };
}

describe('snapToCardinal', () => {
  it('snaps a drag along an axis to that direction', () => {
    expect(snapToCardinal(40, 0)).toBe(Direction.Right);
    expect(snapToCardinal(-40, 0)).toBe(Direction.Left);
    expect(snapToCardinal(0, 40)).toBe(Direction.Down);
    expect(snapToCardinal(0, -40)).toBe(Direction.Up);
  });

  it('accepts a lean of up to 22.5° off the axis', () => {
    for (const deg of [-22, -10, 0, 10, 22]) {
      const { dx, dy } = drag(deg);
      expect(snapToCardinal(dx, dy), `${deg}° should still read as Right`).toBe(Direction.Right);
    }
  });

  it('emits nothing in the 45° wedge straddling a diagonal', () => {
    // 23°..67° is the wedge between Right and Down: ambiguous, so neither.
    for (const deg of [23, 30, 45, 60, 67]) {
      const { dx, dy } = drag(deg);
      expect(snapToCardinal(dx, dy), `${deg}° should read as no direction`).toBe(Direction.None);
    }
  });

  it('leaves no direction owning a diagonal', () => {
    expect(snapToCardinal(50, 50)).toBe(Direction.None);
    expect(snapToCardinal(-50, 50)).toBe(Direction.None);
    expect(snapToCardinal(50, -50)).toBe(Direction.None);
    expect(snapToCardinal(-50, -50)).toBe(Direction.None);
  });

  it('covers all four wedges around the circle', () => {
    for (const boundary of [45, 135, 225, 315]) {
      for (const offset of [-20, 0, 20]) {
        const { dx, dy } = drag(boundary + offset);
        expect(snapToCardinal(dx, dy), `${boundary + offset}° is in a dead wedge`).toBe(
          Direction.None,
        );
      }
    }
  });

  it('reads a zero-length vector as no direction', () => {
    expect(snapToCardinal(0, 0)).toBe(Direction.None);
  });

  it('keeps the documented arcs', () => {
    expect(ANGULAR_DEAD_ZONE_DEG).toBe(45);
    expect(DIRECTION_ARC_HALF_DEG).toBe(22.5);
  });
});

describe('VirtualJoystick', () => {
  /** A stick whose base centre sits at (100, 100), as the view would set it. */
  function stickAt(x = 100, y = 100): VirtualJoystick {
    const stick = new VirtualJoystick();
    stick.setOrigin({ x, y });
    return stick;
  }

  it('emits nothing while the thumb is inside the dead zone', () => {
    const stick = stickAt();
    stick.press({ x: 105, y: 100 }); // 5px, inside the 12px dead zone.
    expect(stick.sample(0)).toBeNull();
  });

  it('emits an intent once, not on every tick it is held', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });

    expect(stick.sample(0)).toEqual({ dir: Direction.Right, timestamp: 0, source: 'joystick' });
    expect(stick.sample(16)).toBeNull();
  });

  it('measures the drag from the static origin, not from the touch point', () => {
    const stick = stickAt();
    // Landing left of the ring is a Left request straight away; the base does
    // not follow the thumb, so the press itself carries a direction.
    stick.press({ x: 40, y: 100 });
    expect(stick.sample(0)?.dir).toBe(Direction.Left);
  });

  it('emits nothing for a drag into a dead wedge, keeping the latch', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(stick.sample(0)?.dir).toBe(Direction.Right);

    stick.move({ x: 140, y: 140 }); // 45°: ambiguous between Right and Down.
    expect(stick.sample(16)).toBeNull();

    stick.move({ x: 100, y: 140 }); // Committed to Down at last.
    expect(stick.sample(32)?.dir).toBe(Direction.Down);
  });

  it('clamps the knob to the drag radius', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 500, y: 0 });

    const offset = stick.knobOffset();
    expect(offset).not.toBeNull();
    expect(Math.hypot(offset!.x, offset!.y)).toBeCloseTo(stick.maxRadius, 6);
  });

  it('scales the dead zone and radius with the screen', () => {
    const stick = new VirtualJoystick();
    const baseDeadZone = stick.deadZone;
    stick.setScale(2);
    expect(stick.deadZone).toBe(baseDeadZone * 2);
  });

  it('keeps the latch when the thumb lifts, as an arcade stick would', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(stick.sample(0)?.dir).toBe(Direction.Right);

    stick.release();
    expect(stick.sample(16)).toBeNull(); // No new intent — and no "stop" either.

    // Re-pressing and pushing the same way is not a change, so it stays quiet.
    stick.press({ x: 140, y: 100 });
    expect(stick.sample(32)).toBeNull();
  });
});
