import {
  JOYSTICK_BASE_PX,
  JOYSTICK_KNOB_PX,
  JOYSTICK_RECENTRE_PX,
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
 * `getBoundingClientRect` — the zone's rect is cached on resize, because a
 * synchronous layout read inside a pointer handler is the classic way to blow
 * the input latency budget (§4.4).
 */
export class JoystickView {
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private zoneRect: DOMRect;
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
    this.zoneRect = zone.getBoundingClientRect();

    // passive:false so preventDefault can suppress native gestures (§4.1).
    const options: AddEventListenerOptions = { passive: false };
    zone.addEventListener('pointerdown', this.onPointerDown, options);
    zone.addEventListener('pointermove', this.onPointerMove, options);
    zone.addEventListener('pointerup', this.onPointerEnd, options);
    zone.addEventListener('pointercancel', this.onPointerEnd, options);
  }

  /**
   * Re-measure and rescale. Called on every layout change; the cached rect is
   * what keeps the pointer handlers free of layout reads.
   */
  resize(): void {
    this.zoneRect = this.zone.getBoundingClientRect();

    // Same physical size on a small Android and a Pro Max (product spec §3.1).
    const scale = Math.min(1.25, Math.max(0.85, window.innerWidth / 390));
    this.joystick.setScale(scale);
    this.zone.style.setProperty('--joystick-base-size', `${JOYSTICK_BASE_PX * scale}px`);
    this.zone.style.setProperty('--joystick-knob-size', `${JOYSTICK_KNOB_PX * scale}px`);
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

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return; // Ignore a second thumb.
    event.preventDefault();

    this.activePointerId = event.pointerId;
    this.zone.setPointerCapture(event.pointerId);

    // Float the base to the thumb, clamped so the whole ring stays in the zone.
    const half = (JOYSTICK_BASE_PX * this.scaleFromCss()) / 2;
    const localX = clamp(event.clientX - this.zoneRect.left, half, this.zoneRect.width - half);
    const localY = clamp(event.clientY - this.zoneRect.top, half, this.zoneRect.height - half);
    this.base.style.left = `${localX}px`;
    this.base.style.top = `${localY}px`;
    this.base.classList.add('joystick__base--active');

    this.joystick.press({ x: this.zoneRect.left + localX, y: this.zoneRect.top + localY });
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

    if (this.zone.hasPointerCapture(event.pointerId)) {
      this.zone.releasePointerCapture(event.pointerId);
    }
    this.activePointerId = null;

    this.joystick.release();
    this.base.classList.remove('joystick__base--active');
    this.base.style.left = '';
    this.base.style.top = '';
    this.syncKnob();
  };

  private scaleFromCss(): number {
    return Math.min(1.25, Math.max(0.85, window.innerWidth / 390));
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}
