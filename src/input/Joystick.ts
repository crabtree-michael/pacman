import type { Direction } from '../game/types';
import type { InputManager, InputSource } from './InputManager';

export interface JoystickOptions {
  /** Drag distance, in CSS pixels, before a direction registers. */
  deadZonePx?: number;
  /**
   * Re-centre the joystick under the thumb on touch-down. A floating stick
   * beats a fixed one on a phone — the player never has to look down to find
   * it.
   */
  floating?: boolean;
}

const DEFAULT_DEAD_ZONE_PX = 12;

/**
 * Virtual thumb-stick over a touch surface.
 *
 * Steering is quantised to the four cardinal directions by dominant axis —
 * the maze is a grid, so diagonals have nothing to mean. The knob still
 * follows the thumb freely, which is what makes the control feel analogue
 * even though its output is not.
 *
 * Pointer Events cover touch, pen and mouse in one path; the CSS on `.joystick`
 * sets `touch-action: none` so the browser does not steal the drag for
 * scrolling.
 */
export class Joystick implements InputSource {
  private manager: InputManager | null = null;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly deadZonePx: number;
  private readonly floating: boolean;

  private activePointerId: number | null = null;
  private originX = 0;
  private originY = 0;

  constructor(
    private readonly zone: HTMLElement,
    options: JoystickOptions = {},
  ) {
    const base = zone.querySelector<HTMLElement>('.joystick__base');
    const knob = zone.querySelector<HTMLElement>('.joystick__knob');
    if (!base || !knob) {
      throw new Error('Joystick zone is missing its .joystick__base / .joystick__knob');
    }
    this.base = base;
    this.knob = knob;
    this.deadZonePx = options.deadZonePx ?? DEFAULT_DEAD_ZONE_PX;
    this.floating = options.floating ?? true;
  }

  attach(manager: InputManager): void {
    this.manager = manager;
    this.zone.addEventListener('pointerdown', this.onPointerDown);
    this.zone.addEventListener('pointermove', this.onPointerMove);
    this.zone.addEventListener('pointerup', this.onPointerEnd);
    this.zone.addEventListener('pointercancel', this.onPointerEnd);
  }

  detach(): void {
    this.zone.removeEventListener('pointerdown', this.onPointerDown);
    this.zone.removeEventListener('pointermove', this.onPointerMove);
    this.zone.removeEventListener('pointerup', this.onPointerEnd);
    this.zone.removeEventListener('pointercancel', this.onPointerEnd);
    this.release();
    this.manager = null;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return; // Ignore a second thumb.

    this.activePointerId = event.pointerId;
    // Capture so the drag keeps reporting even if the thumb leaves the zone.
    this.zone.setPointerCapture(event.pointerId);

    if (this.floating) {
      const zoneRect = this.zone.getBoundingClientRect();
      this.base.style.left = `${event.clientX - zoneRect.left}px`;
      this.base.style.top = `${event.clientY - zoneRect.top}px`;
      this.base.style.bottom = 'auto';
      this.base.style.transform = 'translate(-50%, -50%)';
    }

    const baseRect = this.base.getBoundingClientRect();
    this.originX = baseRect.left + baseRect.width / 2;
    this.originY = baseRect.top + baseRect.height / 2;

    this.base.classList.add('joystick__base--active');
    this.update(event.clientX, event.clientY);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.update(event.clientX, event.clientY);
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.release();
  };

  private update(clientX: number, clientY: number): void {
    const offsetX = clientX - this.originX;
    const offsetY = clientY - this.originY;
    const distance = Math.hypot(offsetX, offsetY);

    const maxRadius = this.base.getBoundingClientRect().width / 2;
    const clamp = distance > maxRadius && distance > 0 ? maxRadius / distance : 1;
    this.knob.style.transform = `translate(calc(-50% + ${offsetX * clamp}px), calc(-50% + ${offsetY * clamp}px))`;

    if (distance < this.deadZonePx) return;

    const direction: Direction =
      Math.abs(offsetX) > Math.abs(offsetY)
        ? offsetX > 0
          ? 'right'
          : 'left'
        : offsetY > 0
          ? 'down'
          : 'up';
    this.manager?.setDirection(direction);
  }

  private release(): void {
    if (this.activePointerId !== null && this.zone.hasPointerCapture(this.activePointerId)) {
      this.zone.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;

    this.knob.style.transform = '';
    this.base.classList.remove('joystick__base--active');
    if (this.floating) {
      this.base.style.left = '';
      this.base.style.top = '';
      this.base.style.bottom = '';
      this.base.style.transform = '';
    }

    // Releasing the stick stops steering; Pac-Man keeps his last heading, which
    // is what an arcade player expects.
    this.manager?.clearDirection();
  }
}
