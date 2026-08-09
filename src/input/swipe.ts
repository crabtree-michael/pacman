import { Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';
import type { Vec2 } from './joystick';

/**
 * Swipe-to-steer on the maze (product spec §3.3).
 *
 * A convenience for players who dislike joysticks, sharing the same intent
 * pipeline so nothing downstream can tell it from the stick. Unlike the
 * joystick it does not latch a *stick position* — one flick is one direction
 * request, and the request stands until something else replaces it.
 */

/** A flick has to travel this far before it counts as a swipe rather than a tap. */
export const SWIPE_MIN_PX = 24;

export class SwipeInput implements InputSource {
  readonly name = 'swipe';

  private origin: Vec2 | null = null;
  private point: Vec2 | null = null;
  private pointerId: number | null = null;
  /** One request per flick: set once the threshold is cleared, until release. */
  private fired = false;
  /**
   * The finger has lifted but the flick has not been read yet.
   *
   * A flick is a *fast* gesture, and the whole point of this pipeline is that
   * handlers store and the tick reads (architecture §4.1) — so a swipe that
   * starts and finishes inside a single frame would be thrown away on release
   * before any tick ever saw it. Holding the vector for one more sample costs
   * nothing and is the difference between a quick flick working and not.
   */
  private released = false;
  private enabled = true;

  constructor(private readonly surface: HTMLElement) {
    const options: AddEventListenerOptions = { passive: false };
    surface.addEventListener('pointerdown', this.onPointerDown, options);
    surface.addEventListener('pointermove', this.onPointerMove, options);
    surface.addEventListener('pointerup', this.onPointerEnd, options);
    surface.addEventListener('pointercancel', this.onPointerEnd, options);
  }

  /** Product spec open question 4 — on by default, a settings toggle either way. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /**
   * The threshold and the axis test run here rather than in the handler, for
   * the same reason the joystick's do: touch events outpace the tick rate, and
   * per-event work buys nothing when the simulation only reads once a tick
   * (architecture §4.1).
   */
  sample(nowMs: number): DirectionIntent | null {
    const intent = this.read(nowMs);
    // A lifted finger's vector is kept only until the tick that reads it.
    if (this.released) this.clear();
    return intent;
  }

  private read(nowMs: number): DirectionIntent | null {
    if (this.fired || !this.enabled || !this.origin || !this.point) return null;

    const dx = this.point.x - this.origin.x;
    const dy = this.point.y - this.origin.y;
    if (Math.hypot(dx, dy) < SWIPE_MIN_PX) return null;

    this.fired = true;
    const dir =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? Direction.Right
          : Direction.Left
        : dy > 0
          ? Direction.Down
          : Direction.Up;
    return { dir, timestamp: nowMs, source: this.name };
  }

  /** Nothing to forget: a flick is consumed the moment it is reported. */
  reset(): void {
    this.clear();
  }

  destroy(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerEnd);
    this.surface.removeEventListener('pointercancel', this.onPointerEnd);
  }

  private clear(): void {
    this.origin = null;
    this.point = null;
    this.pointerId = null;
    this.fired = false;
    this.released = false;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // A gesture still waiting to be read does not block the next one: the newer
    // flick is the one the player means. Only a *live* finger is exclusive.
    if (!this.enabled || (this.pointerId !== null && !this.released)) return;
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    this.point = this.origin;
    this.fired = false;
    this.released = false;
    // Capture so a flick that runs off the board keeps being tracked (§4.1).
    this.surface.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // `released` guards against a stray move for the same id redefining a
    // flick whose finger has already lifted.
    if (event.pointerId !== this.pointerId || this.released) return;
    event.preventDefault();
    this.point = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || this.released) return;
    event.preventDefault();
    if (this.surface.hasPointerCapture(event.pointerId)) {
      this.surface.releasePointerCapture(event.pointerId);
    }
    // Kept, not cleared: the next sample reads the flick and clears it then.
    this.released = true;
  };
}
