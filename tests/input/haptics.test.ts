import { describe, expect, it } from 'vitest';
import { HAPTIC_PULSE_MS, Haptics } from '../../src/input/haptics';
import { Direction, type InputSnapshot } from '../../src/sim/types';

/**
 * A 10 ms pulse on each direction change (product spec §3.2).
 *
 * The vibrate function is injected, so this covers the iOS case — where
 * `navigator.vibrate` does not exist — as plainly as the supported one.
 */

function snapshot(dir: Direction, serial: number): InputSnapshot {
  return { dir, serial };
}

function recorder(): { calls: number[]; vibrate: (pattern: number) => void } {
  const calls: number[] = [];
  return { calls, vibrate: (pattern) => calls.push(pattern) };
}

describe('Haptics', () => {
  it('pulses for the spec-stated duration on a direction change', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(true, vibrate);

    haptics.observe(snapshot(Direction.None, 0)); // Primes; must not buzz.
    haptics.observe(snapshot(Direction.Left, 1));

    expect(calls).toEqual([HAPTIC_PULSE_MS]);
  });

  it('does not pulse on the very first observation', () => {
    const { calls, vibrate } = recorder();
    // Mounting mid-game must not buzz for a direction nobody just asked for.
    new Haptics(true, vibrate).observe(snapshot(Direction.Right, 7));
    expect(calls).toEqual([]);
  });

  it('stays quiet while the direction holds', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(true, vibrate);

    haptics.observe(snapshot(Direction.Up, 1));
    haptics.observe(snapshot(Direction.Up, 2));
    haptics.observe(snapshot(Direction.Up, 3));

    expect(calls).toEqual([]);
  });

  it('pulses once per change across a sequence', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(true, vibrate);

    for (const [dir, serial] of [
      [Direction.Up, 1],
      [Direction.Up, 2],
      [Direction.Left, 3],
      [Direction.Left, 4],
      [Direction.Down, 5],
    ] as const) {
      haptics.observe(snapshot(dir, serial));
    }

    expect(calls).toEqual([HAPTIC_PULSE_MS, HAPTIC_PULSE_MS]);
  });

  it('never buzzes for a latch being cleared', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(true, vibrate);

    haptics.observe(snapshot(Direction.Up, 1));
    // A respawn resets the controller to None. That is not a direction change
    // the player made, so it must not be reported as one.
    haptics.observe(snapshot(Direction.None, 1));

    expect(calls).toEqual([]);
  });

  it('respects the settings toggle', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(false, vibrate);

    haptics.observe(snapshot(Direction.None, 0));
    haptics.observe(snapshot(Direction.Left, 1));
    expect(calls).toEqual([]);

    haptics.setEnabled(true);
    haptics.observe(snapshot(Direction.Up, 2));
    expect(calls).toEqual([HAPTIC_PULSE_MS]);
  });

  it('is inert and honest about it where vibrate does not exist', () => {
    const haptics = new Haptics(true, null);
    expect(haptics.isAvailable).toBe(false);

    haptics.observe(snapshot(Direction.None, 0));
    expect(() => haptics.observe(snapshot(Direction.Left, 1))).not.toThrow();
  });

  it('does not let a throwing vibrate reach the game loop', () => {
    const haptics = new Haptics(true, () => {
      throw new Error('user gesture required');
    });

    haptics.observe(snapshot(Direction.None, 0));
    expect(() => haptics.observe(snapshot(Direction.Left, 1))).not.toThrow();
  });

  it('re-primes after a reset instead of buzzing for the new latch', () => {
    const { calls, vibrate } = recorder();
    const haptics = new Haptics(true, vibrate);

    haptics.observe(snapshot(Direction.Up, 1));
    haptics.reset();
    haptics.observe(snapshot(Direction.Left, 2));

    expect(calls).toEqual([]);
  });
});
