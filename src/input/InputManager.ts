import type { Direction } from '../game/types';

/**
 * A device-specific way to steer — the virtual joystick, the keyboard, and
 * later anything else. Sources push into the manager; nothing reads from them
 * directly.
 */
export interface InputSource {
  attach(manager: InputManager): void;
  detach(): void;
}

/**
 * Collapses every input device into one answer: which way does the player
 * want to go right now?
 *
 * Last writer wins, so picking up the keyboard mid-game just works. The game
 * polls `direction` once per tick rather than reacting to events, which keeps
 * input out of the simulation's timing.
 */
export class InputManager {
  private current: Direction | null = null;
  private readonly sources: InputSource[] = [];

  /** The most recently requested direction, or null if nothing is held. */
  get direction(): Direction | null {
    return this.current;
  }

  setDirection(direction: Direction): void {
    this.current = direction;
  }

  clearDirection(): void {
    this.current = null;
  }

  use(source: InputSource): this {
    source.attach(this);
    this.sources.push(source);
    return this;
  }

  destroy(): void {
    for (const source of this.sources) {
      source.detach();
    }
    this.sources.length = 0;
    this.current = null;
  }
}
