import { Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';

/**
 * Gamepad D-pad steering (product spec §3.3), best-effort.
 *
 * The Gamepad API has no events for button state — it must be polled — which
 * suits this pipeline exactly: `sample()` already runs once per simulation
 * tick, so the poll costs one array read per tick and needs no timer of its
 * own.
 */

/** Standard-mapping D-pad button indices. */
const DPAD_BUTTONS: ReadonlyArray<readonly [number, Direction]> = [
  [12, Direction.Up],
  [13, Direction.Down],
  [14, Direction.Left],
  [15, Direction.Right],
];

/** Left-stick axes, and how far one has to move before it counts. */
const AXIS_X = 0;
const AXIS_Y = 1;
export const GAMEPAD_AXIS_DEAD_ZONE = 0.5;

/** Injected so the tests can drive this without a browser or a controller. */
export type GamepadReader = () => ReadonlyArray<Gamepad | null>;

function defaultReader(): ReadonlyArray<Gamepad | null> {
  // Feature-detected: absent on iOS Safari for a long time, and on anything
  // without the API this source simply never reports.
  return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
    ? navigator.getGamepads()
    : [];
}

export class GamepadInput implements InputSource {
  readonly name = 'gamepad';

  private latched: Direction = Direction.None;

  constructor(private readonly read: GamepadReader = defaultReader) {}

  sample(nowMs: number): DirectionIntent | null {
    const dir = this.readDirection();
    // Nothing held is not a request to stop, exactly as with the joystick:
    // releasing the pad leaves the last direction latched (spec §3.2).
    if (dir === Direction.None || dir === this.latched) return null;

    this.latched = dir;
    return { dir, timestamp: nowMs, source: this.name };
  }

  reset(): void {
    this.latched = Direction.None;
  }

  destroy(): void {
    this.latched = Direction.None;
  }

  /**
   * D-pad first, then the left stick. Both are read from the first connected
   * pad; multiple controllers are not a case this game has.
   */
  private readDirection(): Direction {
    let pads: ReadonlyArray<Gamepad | null>;
    try {
      pads = this.read();
    } catch {
      return Direction.None; // A hostile or absent implementation is not fatal.
    }

    for (const pad of pads) {
      if (!pad || !pad.connected) continue;

      for (const [index, dir] of DPAD_BUTTONS) {
        if (pad.buttons[index]?.pressed) return dir;
      }

      const x = pad.axes[AXIS_X] ?? 0;
      const y = pad.axes[AXIS_Y] ?? 0;
      if (Math.abs(x) < GAMEPAD_AXIS_DEAD_ZONE && Math.abs(y) < GAMEPAD_AXIS_DEAD_ZONE) {
        continue;
      }
      // Dominant axis, no hysteresis: a physical stick has detents and a
      // centring spring, so it does not produce the near-diagonal jitter the
      // touch stick has to defend against.
      if (Math.abs(x) >= Math.abs(y)) return x > 0 ? Direction.Right : Direction.Left;
      return y > 0 ? Direction.Down : Direction.Up;
    }

    return Direction.None;
  }
}
