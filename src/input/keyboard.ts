import { Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';

const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: Direction.Up,
  ArrowDown: Direction.Down,
  ArrowLeft: Direction.Left,
  ArrowRight: Direction.Right,
  KeyW: Direction.Up,
  KeyS: Direction.Down,
  KeyA: Direction.Left,
  KeyD: Direction.Right,
};

/**
 * Keyboard steering — a convenience for desktop and keyboard-equipped tablets,
 * not a supported target (product spec §3.3). It shares the same intent
 * pipeline as the joystick, so nothing downstream can tell them apart.
 */
export class KeyboardInput implements InputSource {
  readonly name = 'keyboard';

  private pending: Direction = Direction.None;

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
  }

  sample(nowMs: number): DirectionIntent | null {
    if (this.pending === Direction.None) return null;
    const intent: DirectionIntent = { dir: this.pending, timestamp: nowMs, source: this.name };
    this.pending = Direction.None;
    return intent;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
  }

  private readonly onKeyDown = (event: Event): void => {
    const direction = KEY_DIRECTIONS[(event as KeyboardEvent).code];
    if (!direction) return;
    event.preventDefault();
    // Store only; the controller reads it on the next tick.
    this.pending = direction;
  };
}
