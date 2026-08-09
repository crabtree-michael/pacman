import type { Direction } from '../game/types';
import type { InputManager, InputSource } from './InputManager';

const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

/**
 * Keyboard steering. Not part of the shipped mobile experience — it exists so
 * the game is playable on a desktop browser while developing.
 */
export class KeyboardInput implements InputSource {
  private manager: InputManager | null = null;
  /** Held keys in press order, so releasing one falls back to the previous. */
  private readonly held: string[] = [];

  constructor(private readonly target: EventTarget = window) {}

  attach(manager: InputManager): void {
    this.manager = manager;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.held.length = 0;
    this.manager = null;
  }

  private readonly onKeyDown = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    const direction = KEY_DIRECTIONS[code];
    if (!direction) return;

    event.preventDefault();
    if (!this.held.includes(code)) {
      this.held.push(code);
    }
    this.manager?.setDirection(direction);
  };

  private readonly onKeyUp = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (!KEY_DIRECTIONS[code]) return;

    const index = this.held.indexOf(code);
    if (index !== -1) {
      this.held.splice(index, 1);
    }

    const stillHeld = this.held[this.held.length - 1];
    if (stillHeld) {
      this.manager?.setDirection(KEY_DIRECTIONS[stillHeld] as Direction);
    } else {
      this.manager?.clearDirection();
    }
  };
}
