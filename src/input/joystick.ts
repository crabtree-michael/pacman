import { Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';

/**
 * Virtual joystick logic — dead zones, angular sectors, 4-way snapping.
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
 * Width of the dead wedge straddling each diagonal, in degrees. A drag that
 * lands in one is too shallow to read as either neighbouring direction, so it
 * emits nothing rather than guessing at the nearer one (spec §3.2).
 */
export const ANGULAR_DEAD_ZONE_DEG = 45;

/**
 * How far off its axis a drag may sit and still count: 22.5° either side, so
 * the four acceptance arcs and the four dead wedges each take half the circle.
 */
export const DIRECTION_ARC_HALF_DEG = (90 - ANGULAR_DEAD_ZONE_DEG) / 2;

/** Accessibility: "enlarges the joystick by 1.5x" (product spec §3.4). */
export const ACCESSIBLE_SIZE_FACTOR = 1.5;

/**
 * ..."and widens the dead zone", on top of the widening the 1.5x size already
 * brings. The spec lists the two as separate effects, and they are: scaling
 * alone keeps the dead zone at 25% of the drag radius, which is the same
 * steadiness demand on a larger control. This factor takes it to 37.5%, so a
 * tremor has somewhere to go before it registers as a turn.
 */
export const ACCESSIBLE_DEAD_ZONE_FACTOR = 1.5;

export interface Vec2 {
  x: number;
  y: number;
}

export class VirtualJoystick implements InputSource {
  readonly name = 'joystick';

  /**
   * Centre of the base ring in client coordinates. The stick is static, so this
   * is a layout constant: the view computes it on every layout change and never
   * touches it from a pointer handler.
   */
  private origin: Vec2 = { x: 0, y: 0 };
  /** Latest raw pointer position, or null while nothing is touching. */
  private point: Vec2 | null = null;
  private latched: Direction = Direction.None;

  /** Scales with screen size so the control feels the same physical size. */
  private scale = 1;
  /** Accessibility mode: a bigger stick with more slack around centre (§3.4). */
  private accessible = false;

  setScale(scale: number): void {
    this.scale = scale;
  }

  setAccessible(accessible: boolean): void {
    this.accessible = accessible;
  }

  setOrigin(origin: Vec2): void {
    this.origin = { x: origin.x, y: origin.y };
  }

  /** The accessibility enlargement alone, without the screen scale. */
  get accessibilityFactor(): number {
    return this.accessible ? ACCESSIBLE_SIZE_FACTOR : 1;
  }

  /** Screen scale and the accessibility enlargement, combined. */
  get sizeScale(): number {
    return this.scale * this.accessibilityFactor;
  }

  get deadZone(): number {
    const extra = this.accessible ? ACCESSIBLE_DEAD_ZONE_FACTOR : 1;
    return JOYSTICK_DEAD_ZONE_PX * this.sizeScale * extra;
  }

  get maxRadius(): number {
    return JOYSTICK_MAX_RADIUS_PX * this.sizeScale;
  }

  /** The quantised direction the ring's chevron shows (product spec §3.2). */
  get snapped(): Direction {
    return this.latched;
  }

  /** True while a thumb is down; the view fades the ring in on the strength of it. */
  get engaged(): boolean {
    return this.point !== null;
  }

  press(point: Vec2): void {
    this.point = point;
  }

  move(point: Vec2): void {
    this.point = point;
  }

  /**
   * Release. The latch is deliberately *not* cleared — Pac-Man carries on in
   * the last direction, exactly as with an arcade stick let go mid-corridor.
   */
  release(): void {
    this.point = null;
  }

  /** Offset of the knob from the base, clamped to the drag radius. */
  knobOffset(): Vec2 | null {
    if (!this.point) return null;
    const dx = this.point.x - this.origin.x;
    const dy = this.point.y - this.origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= this.maxRadius || distance === 0) return { x: dx, y: dy };
    const clamp = this.maxRadius / distance;
    return { x: dx * clamp, y: dy * clamp };
  }

  sample(nowMs: number): DirectionIntent | null {
    if (!this.point) return null; // Released: keep the latch.

    const dx = this.point.x - this.origin.x;
    const dy = this.point.y - this.origin.y;
    if (Math.hypot(dx, dy) < this.deadZone) return null;

    const next = snapToCardinal(dx, dy);
    // None means the drag sits in a dead wedge: no new intent, and the latched
    // direction rides on untouched.
    if (next === Direction.None || next === this.latched) return null;

    this.latched = next;
    return { dir: next, timestamp: nowMs, source: this.name };
  }

  /**
   * Forget the latched direction without letting go of the stick.
   *
   * A thumb that is still down is re-read on the next tick and re-emits, which
   * is the point: only the memory of a *released* stick is stale.
   */
  reset(): void {
    this.latched = Direction.None;
  }

  destroy(): void {
    this.release();
  }
}

/**
 * Map a drag vector to one of the four directions, or to `None`.
 *
 * Each direction owns a 45° arc centred on its axis; the 45° wedges around the
 * diagonals belong to no one. Committing to a direction only when the player is
 * unambiguously pushing that way is what replaced the old hysteresis margin: a
 * wobble near a boundary now reads as "not asking for anything" instead of
 * flickering between two neighbours.
 */
export function snapToCardinal(dx: number, dy: number): Direction {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return Direction.None;

  // Angle to the nearest axis: 0° is dead on it, 45° is a perfect diagonal.
  const offAxisDeg = (Math.atan2(Math.min(ax, ay), Math.max(ax, ay)) * 180) / Math.PI;
  if (offAxisDeg > DIRECTION_ARC_HALF_DEG) return Direction.None;

  if (ax >= ay) return dx > 0 ? Direction.Right : Direction.Left;
  return dy > 0 ? Direction.Down : Direction.Up; // y grows downwards on screen.
}
