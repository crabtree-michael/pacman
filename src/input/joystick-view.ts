import { Direction } from '../sim/types';
import {
  JOYSTICK_BASE_PX,
  JOYSTICK_KNOB_PX,
  JOYSTICK_RECENTRE_PX,
  type Vec2,
  type VirtualJoystick,
} from './joystick';

/**
 * DOM/CSS rendering and pointer plumbing for the joystick.
 *
 * The stick is DOM rather than canvas on purpose: it is compositor-driven,
 * costs zero canvas fill-rate, animates on the GPU, and is trivially themeable
 * (architecture §4.2).
 *
 * The handlers here do nothing but store the raw pointer position and move a
 * transform. No snapping, no dead zone, and above all no
 * `getBoundingClientRect` — the zone's rect and the stick's scale are cached on
 * resize, because a synchronous layout read inside a pointer handler is the
 * classic way to blow the input latency budget (§4.4).
 */

/** Reference width the scale is expressed against — an iPhone 14 (spec §3.1). */
const SCALE_REFERENCE_PX = 390;
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.25;
/**
 * Floor for the fit-to-zone clamp below. Only reachable on a zone too small to
 * hold even a shrunken ring, which the 320 px support floor rules out; it
 * exists so the stick can never collapse to nothing if the maths is ever wrong.
 */
const SCALE_FIT_FLOOR = 0.6;

/** Corner inset for the tablet resting position; clears the 16 px of spec §2.4. */
export const JOYSTICK_INSET_PX = 24;

const DIRECTION_NAMES: Readonly<Record<Direction, string>> = {
  [Direction.None]: 'none',
  [Direction.Up]: 'up',
  [Direction.Left]: 'left',
  [Direction.Down]: 'down',
  [Direction.Right]: 'right',
};

/**
 * Everything about where the stick rests that is not the zone's own size.
 *
 * Spelled out structurally rather than importing the layout and settings types
 * it happens to be assembled from: the input layer has no business reaching
 * into `app/`, and the call site in `main.ts` is where a mismatch would show.
 */
export interface JoystickPlacement {
  /** Wide enough that the stick corners itself rather than centring (§2.1). */
  tablet: boolean;
  orientation: 'portrait' | 'landscape';
  handedness: 'left' | 'right';
}

export interface ZoneSize {
  width: number;
  height: number;
}

/**
 * Where the ring sits when nothing is touching it, in zone-local px.
 *
 * Computed rather than measured. An earlier version read the resting place back
 * out of the rendered element, which made it depend on whether the transform
 * that positions it had been applied yet — the stick then floated to an offset
 * from a place it had never actually been. Arithmetic has no such ordering, and
 * unlike a `getBoundingClientRect` it can be tested without a browser.
 */
export function restPosition(zone: ZoneSize, baseSize: number, placement: JoystickPlacement): Vec2 {
  const half = baseSize / 2;
  const centre = { x: zone.width / 2, y: zone.height / 2 };

  // Only portrait tablets corner the stick. In landscape the gutter is already
  // a thumb-width column, so the middle of it is the reachable spot.
  if (!placement.tablet || placement.orientation !== 'portrait') {
    return clampInto(centre, zone, half);
  }

  const inset = JOYSTICK_INSET_PX + half;
  return clampInto(
    {
      x: placement.handedness === 'right' ? zone.width - inset : inset,
      y: zone.height - inset,
    },
    zone,
    half,
  );
}

/** Keep a ring centre far enough from every edge that the whole ring is inside. */
function clampInto(point: Vec2, zone: ZoneSize, half: number): Vec2 {
  return {
    x: clamp(point.x, half, zone.width - half),
    y: clamp(point.y, half, zone.height - half),
  };
}

export class JoystickView {
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private zoneRect: DOMRect;
  private activePointerId: number | null = null;

  /** Cached so no pointer handler ever has to ask the layout engine. */
  private scale = 1;
  private rest: Vec2 = { x: 0, y: 0 };

  /** Last values written, so an idle frame writes no style at all. */
  private knobTransform = '';
  private chevron: string | null = null;
  private buffered = false;

  constructor(
    private readonly zone: HTMLElement,
    private readonly joystick: VirtualJoystick,
  ) {
    const base = zone.querySelector<HTMLElement>('[data-joystick-base]');
    const knob = zone.querySelector<HTMLElement>('[data-joystick-knob]');
    if (!base || !knob) {
      throw new Error('Control zone is missing its joystick base/knob elements');
    }
    this.base = base;
    this.knob = knob;
    this.zoneRect = zone.getBoundingClientRect();

    // passive:false so preventDefault can suppress native gestures (§4.1).
    const options: AddEventListenerOptions = { passive: false };
    zone.addEventListener('pointerdown', this.onPointerDown, options);
    zone.addEventListener('pointermove', this.onPointerMove, options);
    zone.addEventListener('pointerup', this.onPointerEnd, options);
    zone.addEventListener('pointercancel', this.onPointerEnd, options);
  }

  /**
   * Re-measure and rescale. Called on every layout change; the cached values
   * are what keep the pointer handlers free of layout reads.
   *
   * An in-flight drag is dropped first. That is not a shortcut: the only things
   * that resize the zone mid-game are a rotation or the address bar collapsing,
   * and the spec has both of those pause and re-lay-out rather than carry a
   * half-finished gesture across a screen that has moved under it (§2.4, §5).
   */
  resize(placement: JoystickPlacement): void {
    this.endDrag();
    this.zoneRect = this.zone.getBoundingClientRect();
    this.scale = this.fittedScale();
    this.joystick.setScale(this.scale);

    const size = JOYSTICK_BASE_PX * this.joystick.sizeScale;
    this.zone.style.setProperty('--joystick-base-size', `${size}px`);
    this.zone.style.setProperty(
      '--joystick-knob-size',
      `${JOYSTICK_KNOB_PX * this.joystick.sizeScale}px`,
    );

    this.rest = restPosition(this.zoneRect, size, placement);
    // A relayout lands the ring where the new bands put it. Animating that
    // would mean watching it glide across a screen that has just rotated, and
    // during load it would chase the layout as it settles.
    this.base.classList.remove('joystick__base--returning');
    this.moveBaseTo(this.rest);
  }

  destroy(): void {
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerEnd);
    this.zone.removeEventListener('pointercancel', this.onPointerEnd);
  }

  /**
   * Paint one frame of the stick. Called from the render step, not from a
   * pointer handler, so it runs at most once per displayed frame.
   *
   * Three signals, deliberately different (product spec §3.2): the knob shows
   * the *raw* thumb position so the player can see how near a snapping boundary
   * they are, the chevron shows the *quantised* direction that was actually
   * latched, and the knob's ring tints while a turn request sits buffered and
   * clears the moment the simulation consumes it.
   */
  sync(turnBuffered: boolean): void {
    const offset = this.joystick.knobOffset();
    const transform = offset
      ? `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`
      : 'translate(-50%, -50%)';
    if (transform !== this.knobTransform) {
      this.knob.style.transform = transform;
      this.knobTransform = transform;
    }

    const chevron = DIRECTION_NAMES[this.joystick.snapped];
    if (chevron !== this.chevron) {
      this.base.dataset['direction'] = chevron;
      this.chevron = chevron;
    }

    if (turnBuffered !== this.buffered) {
      this.knob.classList.toggle('joystick__knob--buffered', turnBuffered);
      this.buffered = turnBuffered;
    }
  }

  /** Put the ring's centre at a zone-local point. */
  private moveBaseTo(point: Vec2): void {
    this.base.style.transform = `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`;
  }

  /**
   * The stick's size, in two steps.
   *
   * First the spec's `clamp(0.85, screenWidth / 390, 1.25)`, but measured
   * against the screen's *short* edge. `innerWidth` is the long edge in
   * landscape, which inflated the ring to its 1.25x maximum on the very screens
   * whose gutter is narrowest — a 568x320 phone got a 160 px ring in a 150 px
   * gutter. The short edge is the same number in both orientations, which is
   * what "the same physical size on a small Android and a Pro Max" was after.
   *
   * Then a hard fit to the zone, so the ring can never be wider or taller than
   * the band it has to stay inside no matter what the band maths produces.
   */
  private fittedScale(): number {
    const shortEdge = Math.min(window.innerWidth, window.innerHeight);
    const preferred = clamp(shortEdge / SCALE_REFERENCE_PX, SCALE_MIN, SCALE_MAX);

    const zoneShortSide = Math.min(this.zoneRect.width, this.zoneRect.height);
    const fits = zoneShortSide / (JOYSTICK_BASE_PX * this.joystick.accessibilityFactor);

    return Math.max(SCALE_FIT_FLOOR, Math.min(preferred, fits));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return; // Ignore a second thumb.
    event.preventDefault();

    this.activePointerId = event.pointerId;
    this.zone.setPointerCapture(event.pointerId);

    // Float the base to the thumb, clamped so the whole ring stays inside the
    // zone. Both this and the resting place are zone-local, so the ring lands
    // where the thumb is regardless of where it was resting.
    const half = (JOYSTICK_BASE_PX * this.joystick.sizeScale) / 2;
    const point = clampInto(
      { x: event.clientX - this.zoneRect.left, y: event.clientY - this.zoneRect.top },
      this.zoneRect,
      half,
    );

    // The ring snaps to the thumb, so whatever return is in flight is over.
    this.base.classList.remove('joystick__base--returning');
    this.base.classList.add('joystick__base--active');
    this.moveBaseTo(point);

    this.joystick.press({ x: this.zoneRect.left + point.x, y: this.zoneRect.top + point.y });
    this.joystick.move({ x: event.clientX, y: event.clientY });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.joystick.move({ x: event.clientX, y: event.clientY });
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();

    const offset = this.joystick.knobOffset();
    const wasTap = !offset || Math.hypot(offset.x, offset.y) < JOYSTICK_RECENTRE_PX;
    // TODO(ui): a tap in the control zone should dismiss the attract screen and
    // unlock audio (product spec §2.3, §3.1). Wired once those screens exist.
    void wasTap;

    this.endDrag(event.pointerId);
  };

  /**
   * Let go: drop the capture, put the ring back at its resting place and let
   * the CSS transition carry it there over 200 ms. The *latch* is untouched —
   * releasing the stick does not stop Pac-Man (product spec §3.2).
   */
  private endDrag(pointerId = this.activePointerId): void {
    if (this.activePointerId === null) return;
    if (pointerId !== null && this.zone.hasPointerCapture(pointerId)) {
      this.zone.releasePointerCapture(pointerId);
    }
    this.activePointerId = null;

    this.joystick.release();
    this.base.classList.remove('joystick__base--active');
    this.base.classList.add('joystick__base--returning');
    this.moveBaseTo(this.rest);
    this.sync(this.buffered);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
