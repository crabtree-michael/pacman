import { describe, expect, it } from 'vitest';
import { HYSTERESIS, VirtualJoystick, snapWithHysteresis } from '../../src/input/joystick';
import { Direction } from '../../src/sim/types';

/**
 * Synthetic pointer sequences asserting the emitted direction (architecture §9,
 * "Input"). `joystick.ts` is deliberately DOM-free, so this runs under plain
 * Node; the DOM half lives in the Playwright smoke test.
 */

describe('hysteresis', () => {
  it('holds the latched axis against a challenge inside the margin', () => {
    // Latched right, 100px horizontal against 110px vertical: 1.10x, under the
    // 1.15 margin, so the direction must not flicker.
    expect(snapWithHysteresis(100, 110, Direction.Right)).toBe(Direction.Right);
  });

  it('switches axis once the challenge clears the margin', () => {
    expect(snapWithHysteresis(100, 120, Direction.Right)).toBe(Direction.Down);
  });

  it('lets a reversal along the latched axis through unopposed', () => {
    expect(snapWithHysteresis(-100, 0, Direction.Right)).toBe(Direction.Left);
  });

  it('snaps to the dominant axis when nothing is latched', () => {
    expect(snapWithHysteresis(10, 40, Direction.None)).toBe(Direction.Down);
    expect(snapWithHysteresis(-40, 10, Direction.None)).toBe(Direction.Left);
  });

  it('keeps the documented margin', () => {
    expect(HYSTERESIS).toBe(1.15);
  });
});

describe('VirtualJoystick', () => {
  it('emits nothing while the thumb is inside the dead zone', () => {
    const stick = new VirtualJoystick();
    stick.press({ x: 100, y: 100 });
    stick.move({ x: 105, y: 100 }); // 5px, inside the 12px dead zone.
    expect(stick.sample(0)).toBeNull();
  });

  it('emits an intent once, not on every tick it is held', () => {
    const stick = new VirtualJoystick();
    stick.press({ x: 100, y: 100 });
    stick.move({ x: 140, y: 100 });

    expect(stick.sample(0)).toEqual({ dir: Direction.Right, timestamp: 0, source: 'joystick' });
    expect(stick.sample(16)).toBeNull();
  });

  it('clamps the knob to the drag radius', () => {
    const stick = new VirtualJoystick();
    stick.press({ x: 0, y: 0 });
    stick.move({ x: 500, y: 0 });

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
    const stick = new VirtualJoystick();
    stick.press({ x: 100, y: 100 });
    stick.move({ x: 140, y: 100 });
    expect(stick.sample(0)?.dir).toBe(Direction.Right);

    stick.release();
    expect(stick.sample(16)).toBeNull(); // No new intent — and no "stop" either.

    // Re-pressing and pushing the same way is not a change, so it stays quiet.
    stick.press({ x: 200, y: 200 });
    stick.move({ x: 240, y: 200 });
    expect(stick.sample(32)).toBeNull();
  });
});
