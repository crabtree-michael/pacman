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
 * `getBoundingClientRect` — the base sits still, so its centre is measured on
 * resize and cached, because a synchronous layout read inside a pointer handler
 * is the classic way to blow the input latency budget (§4.4).
 */
export class JoystickView {
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private activePointerId: number | null = null;

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
    this.resize();

    // passive:false so preventDefault can suppress native gestures (§4.1).
    const options: AddEventListenerOptions = { passive: false };
    zone.addEventListener('pointerdown', this.onPointerDown, options);
    zone.addEventListener('pointermove', this.onPointerMove, options);
    zone.addEventListener('pointerup', this.onPointerEnd, options);
    zone.addEventListener('pointercancel', this.onPointerEnd, options);
  }

  /**
   * Re-measure and rescale. Called on every layout change; the cached origin is
   * what keeps the pointer handlers free of layout reads.
   */
  resize(): void {
    // Same physical size on a small Android and a Pro Max (product spec §3.1).
    const scale = Math.min(1.25, Math.max(0.85, window.innerWidth / 390));
    this.joystick.setScale(scale);
    this.zone.style.setProperty('--joystick-base-size', `${JOYSTICK_BASE_PX * scale}px`);
    this.zone.style.setProperty('--joystick-knob-size', `${JOYSTICK_KNOB_PX * scale}px`);

    // Measured after the size variables land, so the ring is already at its new
    // diameter when we take its centre.
    this.joystick.setOrigin(this.measureOrigin());
  }

  destroy(): void {
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerEnd);
    this.zone.removeEventListener('pointercancel', this.onPointerEnd);
  }

  /** Move the knob to follow the thumb. Called once per frame, not per event. */
  syncKnob(): void {
    const offset = this.joystick.knobOffset();
    this.knob.style.transform = offset
      ? `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`
      : 'translate(-50%, -50%)';
  }

  /** Centre of the base ring in client coordinates — CSS decides where it sits. */
  private measureOrigin(): Vec2 {
    const base = this.base.getBoundingClientRect();
    if (base.width > 0 && base.height > 0) {
      return { x: base.left + base.width / 2, y: base.top + base.height / 2 };
    }
    // The ring is hidden on pointer:fine devices, which measure as a zero-sized
    // box; fall back to the middle of the band so a drag there still steers.
    const zone = this.zone.getBoundingClientRect();
    return { x: zone.left + zone.width / 2, y: zone.top + zone.height / 2 };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return; // Ignore a second thumb.
    event.preventDefault();

    this.activePointerId = event.pointerId;
    this.zone.setPointerCapture(event.pointerId);

    // The base stays put (product spec §3.2) — only its opacity reacts.
    this.base.classList.add('joystick__base--active');
    this.joystick.press({ x: event.clientX, y: event.clientY });
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

    if (this.zone.hasPointerCapture(event.pointerId)) {
      this.zone.releasePointerCapture(event.pointerId);
    }
    this.activePointerId = null;

    this.joystick.release();
    this.base.classList.remove('joystick__base--active');
    this.syncKnob();
  };
}
