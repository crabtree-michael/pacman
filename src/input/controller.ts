import { Direction, type InputSnapshot } from '../sim/types';

export interface DirectionIntent {
  dir: Direction;
  timestamp: number;
  source: string;
}

/**
 * A device-facing way to steer. Sources never move Pac-Man; they answer
 * "what does the player want?" when polled once per simulation tick
 * (architecture §4).
 */
export interface InputSource {
  readonly name: string;
  /** Called once per tick. Return an intent only when it *changes*. */
  sample(nowMs: number): DirectionIntent | null;
  /**
   * Forget what was last emitted, so the next sample re-reports the live input.
   * Optional: a source with no memory of its own has nothing to clear.
   */
  reset?(): void;
  destroy(): void;
}

/**
 * Arbitrates between input sources and holds the latched direction.
 *
 * Two behaviours matter here. **Most recent source wins**, so picking up a
 * keyboard mid-game just works. And **the direction latches**: it survives the
 * player lifting their thumb, because on touch the thumb comes off constantly
 * and Pac-Man must keep going (product spec §3.2).
 */
export class InputController {
  private readonly sources: InputSource[] = [];
  private latched: Direction = Direction.None;
  private latchedAt = 0;
  private serial = 0;

  use(source: InputSource): this {
    this.sources.push(source);
    return this;
  }

  /** Poll every source. Call once per simulation tick, before `step`. */
  sample(nowMs: number): void {
    for (const source of this.sources) {
      const intent = source.sample(nowMs);
      if (!intent || intent.dir === Direction.None) continue;
      if (intent.timestamp < this.latchedAt) continue;

      this.latched = intent.dir;
      this.latchedAt = intent.timestamp;
      this.serial++;
    }
  }

  snapshot(): InputSnapshot {
    return { dir: this.latched, serial: this.serial };
  }

  /** The direction currently being requested. Read by the HUD and haptics. */
  get direction(): Direction {
    return this.latched;
  }

  /**
   * Clear the latch — used on death and level start so the player does not
   * respawn already walking into a ghost (product spec open question 1).
   *
   * The sources are cleared too, and that part is not optional. A source only
   * emits on *change*, so a joystick still latched Right would report nothing
   * on the next tick and the controller would sit at `None` with the player's
   * thumb visibly pushed right. Clearing both means a thumb that is still down
   * re-reports itself immediately — a held stick is a live request, and only
   * the sticky memory of a released one is meant to be forgotten.
   */
  reset(): void {
    this.latched = Direction.None;
    this.latchedAt = 0;
    for (const source of this.sources) {
      source.reset?.();
    }
  }

  destroy(): void {
    for (const source of this.sources) {
      source.destroy();
    }
    this.sources.length = 0;
  }
}
