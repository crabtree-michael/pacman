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
 *
 * Two things are tracked, and they are not the same thing. A keydown is an
 * *event*: it is read once and it steers, which is why a second press of the
 * key already latched still re-asserts it. What is *held* is a state, and it
 * exists so the on-screen stick can show it — a player on a keyboard should see
 * the same ring lean and spring back that a thumb gets, or the control on
 * screen is quietly lying about what is driving the game (§3.3).
 */
export class KeyboardInput implements InputSource {
  readonly name = 'keyboard';

  private pending: Direction = Direction.None;
  /**
   * Direction keys currently down, most recent last. An array rather than a
   * set: with two keys held the newer one is the one the player means, and a
   * set has no opinion about which that is.
   */
  private readonly down: string[] = [];

  constructor(private readonly target: EventTarget = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    // A window that loses focus never delivers the keyup, so the key would stay
    // held for ever — visibly, on the stick — until it was pressed again.
    this.target.addEventListener('blur', this.onBlur);
  }

  /** The direction being held right now, for the stick to draw. */
  get direction(): Direction {
    const code = this.down[this.down.length - 1];
    return code === undefined ? Direction.None : (KEY_DIRECTIONS[code] ?? Direction.None);
  }

  sample(nowMs: number): DirectionIntent | null {
    if (this.pending === Direction.None) return null;
    const intent: DirectionIntent = { dir: this.pending, timestamp: nowMs, source: this.name };
    this.pending = Direction.None;
    return intent;
  }

  /**
   * Forget what was emitted — and, if a key is still down, say it again.
   *
   * The same rule as the joystick's held thumb: a reset clears the memory of
   * input that is over, not input that is still happening. Without the
   * re-assertion a player holding Right through a respawn would watch the stick
   * lean right while Pac-Man stood still, waiting for a key they were already
   * pressing.
   */
  reset(): void {
    this.pending = this.direction;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.down.length = 0;
    this.pending = Direction.None;
  }

  private readonly onKeyDown = (event: Event): void => {
    const key = event as KeyboardEvent;
    const direction = KEY_DIRECTIONS[key.code];
    if (!direction) return;
    event.preventDefault();
    // Auto-repeat is the operating system talking, not the player: it says
    // nothing new about what is held, and its rate is a system setting the game
    // has no business steering by.
    if (key.repeat) return;

    if (!this.down.includes(key.code)) this.down.push(key.code);
    // Store only; the controller reads it on the next tick.
    this.pending = direction;
  };

  private readonly onKeyUp = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    const at = this.down.indexOf(code);
    if (at === -1) return;
    // Releasing does not stop Pac-Man — the latch survives, exactly as it does
    // when a thumb comes off the stick (product spec §3.2). Only the drawing
    // goes home.
    this.down.splice(at, 1);

    // Unless another key is still down. Letting go of Up while Right is held is
    // a request for Right: it is what the hand is doing and what the stick is
    // about to show, so the simulation had better agree with both.
    const remaining = this.direction;
    if (remaining !== Direction.None) this.pending = remaining;
  };

  private readonly onBlur = (): void => {
    this.down.length = 0;
  };
}
