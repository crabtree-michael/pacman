import { describe, expect, it } from 'vitest';
import { GAMEPAD_AXIS_DEAD_ZONE, GamepadInput } from '../../src/input/gamepad';
import { Direction } from '../../src/sim/types';

/**
 * Gamepad D-pad steering (product spec §3.3). The reader is injected, so this
 * runs headless with no controller and no Gamepad API.
 */

/** Enough of a `Gamepad` for the source; the real type is far wider. */
function pad(options: { buttons?: number[]; axes?: number[]; connected?: boolean }): Gamepad {
  const pressed = new Set(options.buttons ?? []);
  return {
    connected: options.connected ?? true,
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.has(index) })),
    axes: options.axes ?? [0, 0],
  } as unknown as Gamepad;
}

describe('GamepadInput', () => {
  it('reads the D-pad', () => {
    const input = new GamepadInput(() => [pad({ buttons: [14] })]);
    expect(input.sample(0)?.dir).toBe(Direction.Left);
  });

  it('emits once and then stays quiet while the button is held', () => {
    const input = new GamepadInput(() => [pad({ buttons: [12] })]);
    expect(input.sample(0)?.dir).toBe(Direction.Up);
    expect(input.sample(16)).toBeNull();
  });

  it('keeps the latch when everything is released, as the joystick does', () => {
    let held = [12];
    const input = new GamepadInput(() => [pad({ buttons: held })]);
    expect(input.sample(0)?.dir).toBe(Direction.Up);

    held = [];
    // Letting go is not a request to stop — no intent, and no "None" either.
    expect(input.sample(16)).toBeNull();
  });

  it('ignores a stick inside its dead zone', () => {
    const inside = GAMEPAD_AXIS_DEAD_ZONE - 0.01;
    const input = new GamepadInput(() => [pad({ axes: [inside, inside] })]);
    expect(input.sample(0)).toBeNull();
  });

  it('snaps the stick to its dominant axis past the dead zone', () => {
    const input = new GamepadInput(() => [pad({ axes: [-0.6, 0.9] })]);
    expect(input.sample(0)?.dir).toBe(Direction.Down);
  });

  it('prefers the D-pad over the stick when both are pushed', () => {
    const input = new GamepadInput(() => [pad({ buttons: [15], axes: [0, -1] })]);
    expect(input.sample(0)?.dir).toBe(Direction.Right);
  });

  it('skips empty slots and disconnected pads', () => {
    const input = new GamepadInput(() => [
      null,
      pad({ buttons: [12], connected: false }),
      pad({ buttons: [13] }),
    ]);
    expect(input.sample(0)?.dir).toBe(Direction.Down);
  });

  it('reports nothing when there is no gamepad at all', () => {
    expect(new GamepadInput(() => []).sample(0)).toBeNull();
  });

  it('survives a reader that throws', () => {
    const input = new GamepadInput(() => {
      throw new Error('no Gamepad API here');
    });
    expect(input.sample(0)).toBeNull();
  });

  it('re-reports the held direction after a reset', () => {
    const input = new GamepadInput(() => [pad({ buttons: [14] })]);
    expect(input.sample(0)?.dir).toBe(Direction.Left);
    expect(input.sample(16)).toBeNull();

    // A respawn clears the latch; the pad is still held, so it must speak up.
    input.reset();
    expect(input.sample(32)?.dir).toBe(Direction.Left);
  });
});
