import { DIRECTION_DELTA, Direction } from '../sim/types';
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
/**
 * How far the knob travels from centre at full throw, in CSS px at scale 1.
 *
 * Derived from the two sizes above rather than picked: half the difference is
 * exactly the distance at which the knob comes to rest flush inside the ring,
 * so the base contains it at every scale and in accessible mode. A knob that
 * overhangs its base reads as a puck being dragged around the screen; one that
 * stops at the rim reads as a stick hitting the end of its slot, which is the
 * whole of what a gated 4-way stick has to communicate.
 *
 * It bounds the *drawing* only. The vector the direction is read from is the
 * one from the ring's centre to the thumb, however far out that lands (§3.2).
 */
export const JOYSTICK_TRAVEL_PX = (JOYSTICK_BASE_PX - JOYSTICK_KNOB_PX) / 2;
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
 * alone keeps the dead zone at a third of the throw, which is the same
 * steadiness demand on a larger control. This factor takes it to half, so a
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

  /** How far the knob may leave centre along its slot, at the current size. */
  get travel(): number {
    return JOYSTICK_TRAVEL_PX * this.sizeScale;
  }

  /** How far the thumb is from the ring's centre, or 0 while nothing is down. */
  get dragDistance(): number {
    if (!this.point) return 0;
    return Math.hypot(this.point.x - this.origin.x, this.point.y - this.origin.y);
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

  /**
   * Where to draw the knob: on one of four slots, never between them, and never
   * further out than the throw. `null` means "nothing is down" — the view reads
   * that as the trip home to centre.
   *
   * The stick is gated, so the knob moves like one. Letting it sit anywhere in
   * the ring promised an analogue control that the game then refused to read
   * diagonally; running it along the axes shows the player the gate they are
   * actually pushing against. What survives from the raw drag is *how far* along
   * the slot the thumb has pushed, which is what keeps a dead wedge legible —
   * the knob hangs back near centre while the chevron holds its direction.
   *
   * Choosing the slot: the direction the drag unambiguously asks for, and while
   * it sits in a dead wedge the latched one. A real stick does not fall back to
   * centre when a thumb wanders onto a diagonal; it stays in the slot it is in
   * until the push is clearly for another.
   */
  knobOffset(): Vec2 | null {
    if (!this.point) return null;
    const dx = this.point.x - this.origin.x;
    const dy = this.point.y - this.origin.y;

    const cardinal = snapToCardinal(dx, dy);
    const slot = cardinal === Direction.None ? this.latched : cardinal;
    if (slot === Direction.None) return { x: 0, y: 0 };

    // The axes are unit vectors, so the dot product is the distance pushed along
    // the slot. Negative means the drag has crossed behind the gate's centre —
    // only reachable from a wedge, and the far end of the slot is not where a
    // stick goes when it is pushed the other way, so it rests at centre.
    const axis = DIRECTION_DELTA[slot];
    const pushed = clamp(dx * axis.x + dy * axis.y, 0, this.travel);
    return { x: axis.x * pushed, y: axis.y * pushed };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
