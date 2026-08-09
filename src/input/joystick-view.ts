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
 * The handlers here do nothing but store the raw pointer position. No snapping,
 * no dead zone, and above all no `getBoundingClientRect` — the zone's rect, the
 * stick's scale and the ring's centre are cached on resize, because a
 * synchronous layout read inside a pointer handler is the classic way to blow
 * the input latency budget (§4.4).
 */

/**
 * Desktop only: a cursor steers the stick by being over it, with no button held
 * (product spec §3.3).
 *
 * Gated on the media query rather than on `pointerType`, because the question
 * is not what dispatched this event but whether the machine has a pointer that
 * can *rest* somewhere. On a touchscreen there is no such thing — a finger is
 * either on the glass or gone — and a synthetic mouse event standing in for a
 * tap must not turn the band into a live control under it.
 */
const HOVER_QUERY = '(hover: hover)';

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
 * Where the ring sits, in zone-local px. It is static (product spec §3.2), so
 * this is also where every drag is measured from.
 *
 * Computed rather than measured. An earlier version read the position back out
 * of the rendered element, which made it depend on whether the transform that
 * positions it had been applied yet. Arithmetic has no such ordering, and
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

/**
 * What the stick has to show this frame that it cannot see for itself.
 *
 * The ring is the game's one control, not the joystick's own read-out: whatever
 * is steering — a thumb, a cursor, a key, a pad — it is what the player looks
 * at to know what the game thinks they asked for. So the chevron is fed the
 * *controller's* latched direction rather than this stick's, and a held key is
 * handed over so the knob can lean on it.
 */
export interface JoystickDisplay {
  /** The direction the simulation is being asked for, whatever asked for it. */
  requested: Direction;
  /** A direction held down on the keyboard, or `None`. */
  held: Direction;
  /** A turn request is buffered, waiting for a legal moment to fire. */
  buffered: boolean;
}

const IDLE_DISPLAY: JoystickDisplay = {
  requested: Direction.None,
  held: Direction.None,
  buffered: false,
};

export class JoystickView {
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private zoneRect: DOMRect;
  private activePointerId: number | null = null;
  /** True while a buttonless cursor is the thing on the stick. */
  private hovering = false;

  /**
   * Live rather than read once: a mouse plugged into a tablet mid-session
   * flips this, and `matches` is a property read cheap enough to do per event.
   * Absent in jsdom, and on anything without it hover simply never happens.
   */
  private readonly hoverQuery: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(HOVER_QUERY)
      : null;

  /** Cached so no pointer handler ever has to ask the layout engine. */
  private scale = 1;
  private rest: Vec2 = { x: 0, y: 0 };

  /** Last values written, so an idle frame writes no style at all. */
  private knobTransform = '';
  private chevron: string | null = null;
  private buffered = false;
  private active = false;
  /** The last frame's display, so a handler can repaint without one. */
  private display: JoystickDisplay = IDLE_DISPLAY;

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
    // A cursor can leave the band without a last move inside it — off the
    // bottom of the window, or out of the document altogether — and a stick
    // left leaning would go on steering with nothing on it.
    zone.addEventListener('pointerleave', this.onPointerLeave, options);
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
    this.endHover();
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
    this.moveBaseTo(this.rest);
    // The ring is where every drag is measured from, so the joystick needs it in
    // client coordinates. Handing it over here is what keeps the pointer
    // handlers free of layout reads.
    this.joystick.setOrigin({
      x: this.zoneRect.left + this.rest.x,
      y: this.zoneRect.top + this.rest.y,
    });
  }

  destroy(): void {
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerEnd);
    this.zone.removeEventListener('pointercancel', this.onPointerEnd);
    this.zone.removeEventListener('pointerleave', this.onPointerLeave);
  }

  /**
   * Paint one frame of the stick. Called from the render step, not from a
   * pointer handler, so it runs at most once per displayed frame.
   *
   * Three signals, deliberately different (product spec §3.2): the knob runs
   * along its slot to show how hard the stick is being pushed and which way,
   * the chevron shows the *quantised* direction that was actually latched, and
   * the knob's ring tints while a turn request sits buffered and clears the
   * moment the simulation consumes it.
   *
   * A pointer on the stick outranks a held key, because it is the finer of the
   * two: a cursor at half throw has said something a key cannot. With neither,
   * the stick has no offset at all, so the same write that tracks the thumb is
   * also the one that sends the knob home; the CSS eases it there because the
   * `--active` class it eased against has just come off.
   */
  sync(display: JoystickDisplay): void {
    this.display = display;

    const offset = this.joystick.knobOffset() ?? this.joystick.throwOffset(display.held);
    const transform = offset
      ? `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`
      : 'translate(-50%, -50%)';
    if (transform !== this.knobTransform) {
      this.knob.style.transform = transform;
      this.knobTransform = transform;
    }

    const chevron = DIRECTION_NAMES[display.requested];
    if (chevron !== this.chevron) {
      this.base.dataset['direction'] = chevron;
      this.chevron = chevron;
    }

    this.setActive(this.joystick.engaged || display.held !== Direction.None);

    if (display.buffered !== this.buffered) {
      this.knob.classList.toggle('joystick__knob--buffered', display.buffered);
      this.buffered = display.buffered;
    }
  }

  /**
   * Light the ring, or let it fade. The single writer of the class: a press
   * calls it for the immediacy, and every frame agrees with the press, so the
   * two can never leave the ring lit over an empty stick.
   */
  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.base.classList.toggle('joystick__base--active', active);
  }

  /** Put the ring's centre at a zone-local point. Only `resize` ever does this. */
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
    // A press takes the stick off the cursor and puts it on the drag, without
    // letting go in between: the position is about to be overwritten anyway.
    this.hovering = false;
    this.base.classList.remove('joystick__base--hover');
    this.zone.setPointerCapture(event.pointerId);

    // The ring stays where it is (product spec §3.2) — only its opacity reacts.
    // The drag is measured from that fixed centre, so a touch that lands away
    // from it already carries a direction.
    this.setActive(true);
    this.joystick.press({ x: event.clientX, y: event.clientY });
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) {
      event.preventDefault();
      this.joystick.move({ x: event.clientX, y: event.clientY });
      return;
    }
    // Nothing is down: on a machine with a cursor, being over the stick is
    // itself the input (product spec §3.3). A second finger during a drag is
    // still ignored — `activePointerId` is what says a drag owns the stick.
    if (this.activePointerId === null) {
      this.hoverTo({ x: event.clientX, y: event.clientY });
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();

    // Measured on the thumb, not on the knob: a drag that spent its whole life
    // in a dead wedge barely moved the knob, and it was still a drag.
    const wasTap = this.joystick.dragDistance < JOYSTICK_RECENTRE_PX;
    // TODO(ui): a tap in the control zone should dismiss the attract screen and
    // unlock audio (product spec §2.3, §3.1). Wired once those screens exist.
    void wasTap;

    this.endDrag(event.pointerId);
    // The button came up but the cursor did not go anywhere, so the stick goes
    // back to being hovered rather than idle. Letting go of a mouse is not the
    // same statement as taking a thumb off the glass — and only a mouse leaves
    // anything behind to hover with, which is why the type is asked for here
    // and nowhere else: a lifted finger would otherwise re-grab the stick and
    // never send another event to let go of it.
    if (event.pointerType === 'mouse') {
      this.hoverTo({ x: event.clientX, y: event.clientY });
    }
  };

  private readonly onPointerLeave = (): void => {
    this.endHover();
  };

  /**
   * The cursor is somewhere. Inside the stick's reach that is a grab it never
   * has to make explicit; outside it, it is a release — the knob springs home
   * and the ring fades, while the latched direction rides on exactly as it does
   * when a thumb lifts (product spec §3.2, §3.3).
   */
  private hoverTo(point: Vec2): void {
    if (this.activePointerId !== null) return; // A drag owns the stick.
    if (!(this.hoverQuery?.matches ?? false) || !this.joystick.withinHoverArea(point)) {
      this.endHover();
      return;
    }

    if (this.hovering) {
      this.joystick.move(point);
      return;
    }
    this.hovering = true;
    this.base.classList.add('joystick__base--hover');
    this.setActive(true);
    this.joystick.press(point);
  }

  /**
   * Let go: drop the capture, fade the ring back out over 200 ms and let the
   * knob spring back to centre under it, the way a sprung stick does. The ring
   * itself has not moved and does not travel anywhere. The *latch* is untouched
   * — releasing the stick does not stop Pac-Man (product spec §3.2).
   *
   * The sync is what actually sends the knob home, and it has to happen here
   * rather than waiting for the next rendered frame: a release during a paused
   * or backgrounded game gets no more frames, and a knob left leaning is the
   * one thing on screen still claiming a thumb is down.
   */
  private endDrag(pointerId = this.activePointerId): void {
    if (this.activePointerId === null) return;
    if (pointerId !== null && this.zone.hasPointerCapture(pointerId)) {
      this.zone.releasePointerCapture(pointerId);
    }
    this.activePointerId = null;

    this.joystick.release();
    this.sync(this.display);
  }

  /**
   * The cursor has left the stick's reach. Same ending as a lifted thumb, for
   * the same reason it has to happen here rather than on the next frame: a
   * paused or backgrounded game gets no more frames, and a knob left leaning is
   * the one thing on screen still claiming somebody is steering.
   */
  private endHover(): void {
    if (!this.hovering) return;
    this.hovering = false;
    this.base.classList.remove('joystick__base--hover');
    this.joystick.release();
    this.sync(this.display);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
