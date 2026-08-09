import { describe, expect, it } from 'vitest';
import {
  ACCESSIBLE_DEAD_ZONE_FACTOR,
  ACCESSIBLE_SIZE_FACTOR,
  HYSTERESIS,
  JOYSTICK_DEAD_ZONE_PX,
  JOYSTICK_MAX_RADIUS_PX,
  VirtualJoystick,
  snapWithHysteresis,
} from '../../src/input/joystick';
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

  it('reports the snapped direction for the ring chevron', () => {
    const stick = new VirtualJoystick();
    expect(stick.snapped).toBe(Direction.None);

    stick.press({ x: 100, y: 100 });
    stick.move({ x: 100, y: 40 });
    stick.sample(0);

    // The chevron shows the quantised direction while the knob shows the raw
    // thumb position — the two are deliberately different (spec §3.2).
    expect(stick.snapped).toBe(Direction.Up);
    expect(stick.knobOffset()).not.toEqual({ x: 0, y: 0 });
  });

  it('knows whether a thumb is down', () => {
    const stick = new VirtualJoystick();
    expect(stick.engaged).toBe(false);

    stick.press({ x: 10, y: 10 });
    expect(stick.engaged).toBe(true);

    stick.release();
    expect(stick.engaged).toBe(false);
    // Released, but still latched: the ring keeps showing where he is headed.
    expect(stick.snapped).toBe(Direction.None);
  });

  it('drops the latch on reset without letting go of the stick', () => {
    const stick = new VirtualJoystick();
    stick.press({ x: 100, y: 100 });
    stick.move({ x: 140, y: 100 });
    expect(stick.sample(0)?.dir).toBe(Direction.Right);

    stick.reset();
    expect(stick.snapped).toBe(Direction.None);
    expect(stick.engaged).toBe(true);
    // The thumb is still there, so the very next tick re-reports it.
    expect(stick.sample(16)?.dir).toBe(Direction.Right);
  });
});

describe('accessibility sizing (product spec §3.4)', () => {
  it('leaves the geometry at spec values by default', () => {
    const stick = new VirtualJoystick();
    expect(stick.sizeScale).toBe(1);
    expect(stick.deadZone).toBe(JOYSTICK_DEAD_ZONE_PX);
    expect(stick.maxRadius).toBe(JOYSTICK_MAX_RADIUS_PX);
  });

  it('enlarges the stick by 1.5x', () => {
    const stick = new VirtualJoystick();
    stick.setAccessible(true);

    expect(stick.accessibilityFactor).toBe(ACCESSIBLE_SIZE_FACTOR);
    expect(stick.maxRadius).toBe(JOYSTICK_MAX_RADIUS_PX * ACCESSIBLE_SIZE_FACTOR);
  });

  it('widens the dead zone by more than the enlargement alone would', () => {
    const stick = new VirtualJoystick();
    const proportional = stick.deadZone * ACCESSIBLE_SIZE_FACTOR;
    stick.setAccessible(true);

    expect(stick.deadZone).toBe(proportional * ACCESSIBLE_DEAD_ZONE_FACTOR);
    // Standard mode spends 25% of the travel on the dead zone; accessible mode
    // spends more, which is the whole point of widening it separately.
    expect(stick.deadZone / stick.maxRadius).toBeGreaterThan(0.25);
  });

  it('compounds with the screen scale rather than replacing it', () => {
    const stick = new VirtualJoystick();
    stick.setScale(1.25);
    stick.setAccessible(true);
    expect(stick.sizeScale).toBe(1.25 * ACCESSIBLE_SIZE_FACTOR);
  });

  it('lets a thumb rest further from centre before it registers a turn', () => {
    const stick = new VirtualJoystick();
    stick.setAccessible(true);
    stick.press({ x: 100, y: 100 });
    // 20px would clear the standard 12px dead zone, but not the widened one.
    stick.move({ x: 120, y: 100 });

    expect(stick.sample(0)).toBeNull();
  });
});
