import { DIRECTION_DELTA, Direction } from '../sim/types';
import type { DirectionIntent, InputSource } from './controller';

/**
 * Virtual joystick logic — dead zones, angular sectors, 4-way snapping, and the
 * short window a fresh drag gets to declare itself before it is read.
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
 * How far past the ring's rim a hovering cursor may stray and still be steering,
 * in CSS px at scale 1 (product spec §3.3).
 *
 * A mouse has no press to say "I mean this one" — the cursor is simply
 * somewhere — so the area it steers from has to be small enough that crossing
 * the band on the way to something else is not steering, and large enough that
 * pushing the stick to its stop does not fall out of it. One knob-radius past
 * the rim is both, and is not an arbitrary number: it is exactly how far the
 * knob's own centre stops short of the rim at full throw, so the cursor keeps
 * control for as far past the gate as the knob still had to give.
 */
export const JOYSTICK_HOVER_MARGIN_PX = JOYSTICK_KNOB_PX / 2;

/**
 * How long a fresh drag has to hold still on one direction before the stick
 * commits to it, in ms (spec §3.2).
 *
 * A thumb does not leave the ring along the axis it is aiming for. It rolls
 * off the knuckle first, so the opening few millimetres of a swipe meant for
 * Right can point almost anywhere — and reading the direction off the first
 * sample to clear the dead zone latched that misread, sending a turn the player
 * never asked for to the buffer before the swipe was half done.
 *
 * So the *first* direction of a gesture has to be asked for twice: the same one
 * on every tick across this window. A transient shorter than it can no longer
 * reach the simulation, which is the whole of the fix; anything longer is a
 * player who really did push that way first.
 *
 * Deliberately not "wait, then read". Waiting a fixed delay and then trusting a
 * single sample moves the misread rather than removing it — the reading at the
 * end of a jab is as wrong as the reading at the start of one. Agreement over
 * time is the thing that separates a gesture that means it from one still
 * forming, and it costs nothing extra when the player does mean it.
 *
 * At 60 ms it is under the ~100 ms at which a delay stops reading as instant,
 * an eighth of the 400 ms pre-turn window a request lands in, and long enough
 * to swallow the roll off a knuckle. Tuning it up buys robustness against
 * longer misreads and spends first-touch responsiveness; the cost is bounded,
 * because only the first commit of a gesture ever waits at all.
 */
export const JOYSTICK_DECIDE_MS = 60;

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

  /**
   * True once the current gesture has got a direction out of the stick. Only
   * the *first* commit of a gesture waits: once the thumb has said which way it
   * is going, every later change of mind inside the same drag lands on the tick
   * it is read. That is where cornering happens, and where a delay would be
   * the thing players actually feel.
   */
  private committed = false;
  /** The direction an undecided drag has been asking for, and since when. */
  private pending: Direction = Direction.None;
  /**
   * Timed off the ticks rather than the pointer events, so the window shares
   * the simulation's clock — the one a test can hand over and a paused game
   * stops, rather than a second clock running underneath it.
   */
  private pendingSince = 0;
  /**
   * A direction a too-quick gesture left behind: see `release`. Emitted by the
   * next `sample`, because a released stick has no position left to read.
   */
  private parting: Direction = Direction.None;

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

  /** Radius of the disc a hovering cursor steers from, at the current size. */
  get hoverRadius(): number {
    return (JOYSTICK_BASE_PX / 2 + JOYSTICK_HOVER_MARGIN_PX) * this.sizeScale;
  }

  /**
   * Is a cursor at `point` inside the area the stick answers to?
   *
   * Only the hovering mouse asks: a thumb owns the whole band, because a touch
   * is a statement of intent wherever it lands, and a drag that wanders out of
   * the ring is still that touch (§3.2). A cursor is only ever *somewhere*, so
   * it has to be somewhere in particular before it counts.
   */
  withinHoverArea(point: Vec2): boolean {
    return Math.hypot(point.x - this.origin.x, point.y - this.origin.y) <= this.hoverRadius;
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

  /**
   * True while something is on the stick — a thumb, or a cursor inside the
   * hover area. The view fades the ring in on the strength of it.
   */
  get engaged(): boolean {
    return this.point !== null;
  }

  /**
   * Where the knob sits when the stick is thrown fully along `dir`: the shape a
   * held key gives it, since a key has no analogue depth to report and so
   * pushes the gate to its stop or not at all. `None` is not a throw, so it
   * draws nothing and the view sends the knob home.
   */
  throwOffset(dir: Direction): Vec2 | null {
    if (dir === Direction.None) return null;
    const axis = DIRECTION_DELTA[dir];
    return { x: axis.x * this.travel, y: axis.y * this.travel };
  }

  /**
   * A thumb goes down, or a cursor crosses into the hover area. A gesture
   * starts here, so this is where the stick forgets having decided anything:
   * every fresh grab is read from scratch, with no credit for how decisively
   * the last one ended. The window itself starts on the first tick that reads a
   * direction, which is when there is finally something to be undecided about.
   */
  press(point: Vec2): void {
    this.point = point;
    this.committed = false;
    this.pending = Direction.None;
    // A flick left over from the last gesture is deliberately left alone: a
    // thumb can be back down before the next tick, and that stab still counts.
  }

  move(point: Vec2): void {
    this.point = point;
  }

  /**
   * Release — a thumb lifting, or a cursor leaving the hover area. The latch is
   * deliberately *not* cleared: Pac-Man carries on in the last direction,
   * exactly as with an arcade stick let go mid-corridor.
   *
   * A lift also ends the argument. A flick that came and went inside the decide
   * window never got to agree with itself, but it is not therefore meaningless:
   * it is a flick, and the position it was let go from is the last and best
   * thing it had to say. Dropping those on the floor would have made the window
   * cost the player a whole class of gesture — the quick stab at a direction —
   * which is not what it is for.
   */
  release(): void {
    if (!this.committed) {
      const parting = this.read();
      this.parting = parting === Direction.None ? this.pending : parting;
    }
    this.point = null;
    this.pending = Direction.None;
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
    if (!this.point) return this.emit(this.parting, nowMs); // Released: keep the latch.

    // None means the drag is in the slack around centre or in a dead wedge:
    // either way it is not asking for anything this tick, and the latched
    // direction rides on untouched. It is not a denial either — a wedge crossed
    // mid-window leaves a pending direction standing rather than restarting it,
    // because "Right, then briefly nothing, then Right" is a thumb pushing
    // right, not a thumb changing its mind.
    const next = this.read();
    if (next === Direction.None) return null;

    if (!this.committed && !this.agreed(next, nowMs)) return null;
    this.committed = true;

    return this.emit(next, nowMs);
  }

  /**
   * Has an undecided gesture asked for the same thing long enough to be taken
   * at its word? The clock starts the first tick a direction is seen and runs
   * only while that direction keeps being the answer.
   */
  private agreed(next: Direction, nowMs: number): boolean {
    if (next !== this.pending) {
      this.pending = next;
      this.pendingSince = nowMs;
      return false;
    }
    return nowMs - this.pendingSince >= JOYSTICK_DECIDE_MS;
  }

  /** The direction the live drag reads as, or `None` for "nothing to say". */
  private read(): Direction {
    if (!this.point) return Direction.None;
    const dx = this.point.x - this.origin.x;
    const dy = this.point.y - this.origin.y;
    if (Math.hypot(dx, dy) < this.deadZone) return Direction.None;
    return snapToCardinal(dx, dy);
  }

  /**
   * Latch a direction, reporting it only if it is a change — and drop any flick
   * still waiting to be reported, which by now has either just been reported or
   * been overtaken by a live drag that got there first.
   */
  private emit(next: Direction, nowMs: number): DirectionIntent | null {
    this.parting = Direction.None;
    if (next === Direction.None || next === this.latched) return null;

    this.latched = next;
    return { dir: next, timestamp: nowMs, source: this.name };
  }

  /**
   * Forget the latched direction without letting go of the stick.
   *
   * A thumb that is still down is re-read on the next tick and re-emits, which
   * is the point: only the memory of a *released* stick is stale.
   *
   * The decide window is deliberately not re-armed. A held stick has already
   * agreed with itself — that is how it came to be latched — and making a
   * respawn spend another 60 ms working out what an unmoved thumb wants would
   * be a delay with nothing left to weigh up.
   *
   * The flick a released stick left behind *is* dropped, though. It is a
   * request from before the death or the pause, and honouring it is exactly the
   * respawn-into-a-ghost this method exists to prevent.
   */
  reset(): void {
    this.latched = Direction.None;
    this.parting = Direction.None;
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
