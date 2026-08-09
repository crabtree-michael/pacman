import { Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';

/**
 * Virtual joystick logic — dead zone, 4-way snapping, hysteresis.
 *
 * Deliberately free of DOM: `joystick-view.ts` owns the elements and the
 * pointer handlers and only ever pushes raw positions in here. Touch events can
 * fire far more often than 60 Hz, so all the maths runs once per tick in
 * `sample()` rather than per event (architecture §4.1).
 */

/** Base geometry in CSS px at scale 1 (product spec §3.1). */
export const JOYSTICK_BASE_PX = 128;
export const JOYSTICK_KNOB_PX = 56;
export const JOYSTICK_MAX_RADIUS_PX = 48;
export const JOYSTICK_DEAD_ZONE_PX = 12;
export const JOYSTICK_RECENTRE_PX = 8;

/**
 * A challenging axis must beat the latched one by this margin before the
 * direction switches. Without it, near-diagonal input flickers (spec §3.2).
 */
export const HYSTERESIS = 1.15;

export interface Vec2 {
  x: number;
  y: number;
}

export class VirtualJoystick implements InputSource {
  readonly name = 'joystick';

  /** Origin, set on pointerdown — the stick floats to the thumb. */
  private base: Vec2 | null = null;
  /** Latest raw pointer position. Written by the view, read once per tick. */
  private point: Vec2 | null = null;
  private latched: Direction = Direction.None;

  /** Scales with screen size so the control feels the same physical size. */
  private scale = 1;

  setScale(scale: number): void {
    this.scale = scale;
  }

  get deadZone(): number {
    return JOYSTICK_DEAD_ZONE_PX * this.scale;
  }

  get maxRadius(): number {
    return JOYSTICK_MAX_RADIUS_PX * this.scale;
  }

  press(base: Vec2): void {
    this.base = base;
    this.point = base;
  }

  move(point: Vec2): void {
    this.point = point;
  }

  /**
   * Release. The latch is deliberately *not* cleared — Pac-Man carries on in
   * the last direction, exactly as with an arcade stick let go mid-corridor.
   */
  release(): void {
    this.base = null;
    this.point = null;
  }

  /** Offset of the knob from the base, clamped to the drag radius. */
  knobOffset(): Vec2 | null {
    if (!this.base || !this.point) return null;
    const dx = this.point.x - this.base.x;
    const dy = this.point.y - this.base.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= this.maxRadius || distance === 0) return { x: dx, y: dy };
    const clamp = this.maxRadius / distance;
    return { x: dx * clamp, y: dy * clamp };
  }

  sample(nowMs: number): DirectionIntent | null {
    if (!this.base || !this.point) return null; // Released: keep the latch.

    const dx = this.point.x - this.base.x;
    const dy = this.point.y - this.base.y;
    if (Math.hypot(dx, dy) < this.deadZone) return null;

    const next = snapWithHysteresis(dx, dy, this.latched);
    if (next === this.latched) return null;

    this.latched = next;
    return { dir: next, timestamp: nowMs, source: this.name };
  }

  destroy(): void {
    this.release();
  }
}

/**
 * Map a drag vector to one of four directions.
 *
 * Switching *axis* needs to beat the incumbent by the hysteresis margin;
 * reversing along the axis you are already on is free, because that is a
 * deliberate flick rather than diagonal noise.
 */
export function snapWithHysteresis(dx: number, dy: number, latched: Direction): Direction {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const horizontal = dx > 0 ? Direction.Right : Direction.Left;
  const vertical = dy > 0 ? Direction.Down : Direction.Up;

  const latchedHorizontal = latched === Direction.Left || latched === Direction.Right;
  const latchedVertical = latched === Direction.Up || latched === Direction.Down;

  if (latchedHorizontal && ay <= ax * HYSTERESIS) return horizontal;
  if (latchedVertical && ax <= ay * HYSTERESIS) return vertical;

  return ax >= ay ? horizontal : vertical;
}
