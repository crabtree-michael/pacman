import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JoystickView, restPosition, type JoystickPlacement } from '../../src/input/joystick-view';
import { JOYSTICK_BASE_PX, VirtualJoystick } from '../../src/input/joystick';
import { Direction } from '../../src/sim/types';

/**
 * The desktop half of the stick (product spec §3.3): a cursor steering by being
 * over the ring, and a held key leaning it.
 *
 * Both are DOM behaviour — which events count, which classes go on — so they
 * are checked through the plumbing rather than around it. The geometry they
 * stand on is `joystick.ts`'s and is tested there under plain Node.
 */

const PHONE: JoystickPlacement = { tablet: false, orientation: 'portrait', handedness: 'left' };
const ZONE = { left: 0, top: 0, width: 390, height: 180 };

/** Whether the machine this test is pretending to be has a cursor. */
let hoverCapable = true;

let zone: HTMLElement;
let base: HTMLElement;
let knob: HTMLElement;
let joystick: VirtualJoystick;
let view: JoystickView;

/** jsdom has no PointerEvent, and no pointer capture to go with it. */
function pointer(type: string, x: number, y: number, pointerType = 'mouse'): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event &
    Record<string, unknown>;
  event['pointerId'] = 1;
  event['pointerType'] = pointerType;
  event['clientX'] = x;
  event['clientY'] = y;
  zone.dispatchEvent(event);
}

/** One frame of the render loop, with nothing else steering. */
function frame(display: Partial<Parameters<JoystickView['sync']>[0]> = {}): void {
  view.sync({
    requested: Direction.None,
    held: Direction.None,
    buffered: false,
    ...display,
  });
}

/**
 * The ring's centre in client coordinates, as `resize` worked it out.
 *
 * Derived rather than assumed to be the middle of the band: the stick docks
 * against the bottom in portrait (product spec §2.1), and a test that guessed
 * at the centre would measure every hover from a few px off the real one — near
 * enough to pass on the axes and to fail on a half-throw push, which is exactly
 * the reading it would then be blaming the wrong code for.
 */
function centre(): { x: number; y: number } {
  const rest = restPosition(ZONE, JOYSTICK_BASE_PX * joystick.sizeScale, PHONE);
  return { x: ZONE.left + rest.x, y: ZONE.top + rest.y };
}

beforeEach(() => {
  hoverCapable = true;
  // jsdom implements no media queries at all; the view reads `matches` per
  // event, so this stub can change its mind mid-test the way a machine does
  // when a mouse is plugged in.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      get matches(): boolean {
        return hoverCapable;
      },
    }),
  });

  zone = document.createElement('div');
  zone.innerHTML = `
    <div class="joystick__base" data-joystick-base data-direction="none">
      <div class="joystick__knob" data-joystick-knob></div>
    </div>`;
  zone.getBoundingClientRect = (): DOMRect =>
    ({
      ...ZONE,
      right: ZONE.left + ZONE.width,
      bottom: ZONE.top + ZONE.height,
      x: ZONE.left,
      y: ZONE.top,
      toJSON: () => ZONE,
    }) as DOMRect;
  zone.setPointerCapture = (): void => {};
  zone.hasPointerCapture = (): boolean => false;
  zone.releasePointerCapture = (): void => {};
  document.body.append(zone);

  base = zone.querySelector<HTMLElement>('[data-joystick-base]')!;
  knob = zone.querySelector<HTMLElement>('[data-joystick-knob]')!;

  joystick = new VirtualJoystick();
  view = new JoystickView(zone, joystick);
  view.resize(PHONE);
});

afterEach(() => {
  view.destroy();
  zone.remove();
});

describe('steering with a cursor (product spec §3.3)', () => {
  it('takes the stick with no button held, once the cursor is over it', () => {
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);

    expect(joystick.engaged, 'the stick should be live under a hovering cursor').toBe(true);
    expect(joystick.snapped, 'nothing is latched until a tick reads it').toBe(Direction.None);
    expect(base.className).toContain('joystick__base--active');
    expect(base.className).toContain('joystick__base--hover');
  });

  it('reads the direction from the cursor’s side of the ring', () => {
    const { x, y } = centre();
    const reach = joystick.travel;

    for (const [dx, dy, expected] of [
      [reach, 0, Direction.Right],
      [-reach, 0, Direction.Left],
      [0, -reach, Direction.Up],
      [0, reach, Direction.Down],
    ] as const) {
      pointer('pointermove', x + dx, y + dy);
      // The stick still has to agree with itself before it commits (§3.2), so
      // the direction is read across a decide window, not off one sample.
      let intent = null;
      for (let t = 0; t <= 120 && !intent; t += 16) intent = joystick.sample(t);
      expect(intent?.dir, `cursor at ${dx},${dy}`).toBe(expected);
      // Straight back to the middle, so the next leg starts from nothing.
      pointer('pointerleave', x, y);
    }
  });

  it('ignores a cursor crossing the band away from the stick', () => {
    // The far end of a 390 px band: over the control zone, nowhere near the
    // ring, and therefore on its way somewhere rather than steering.
    pointer('pointermove', ZONE.left + ZONE.width - 4, centre().y);

    expect(joystick.engaged).toBe(false);
    expect(base.className).not.toContain('joystick__base--active');
  });

  it('lets go when the cursor leaves the stick’s reach', () => {
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);
    frame();
    expect(knob.style.transform).not.toBe('translate(-50%, -50%)');

    pointer('pointermove', x + joystick.hoverRadius + 1, y);

    expect(joystick.engaged).toBe(false);
    expect(base.className).not.toContain('joystick__base--hover');
    expect(base.className).not.toContain('joystick__base--active');
    // The knob is home without waiting for a frame: a paused game renders none.
    expect(knob.style.transform).toBe('translate(-50%, -50%)');
  });

  it('keeps the latched direction when the cursor leaves, as a lifted thumb does', () => {
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);
    for (let t = 0; t <= 120; t += 16) joystick.sample(t);
    expect(joystick.snapped).toBe(Direction.Right);

    pointer('pointerleave', x, y);
    expect(joystick.snapped, 'leaving the stick does not stop Pac-Man').toBe(Direction.Right);
  });

  it('lets go when the cursor leaves the band without a last move inside it', () => {
    const { x, y } = centre();
    pointer('pointermove', x, y - joystick.travel);
    expect(joystick.engaged).toBe(true);

    pointer('pointerleave', x, y);
    expect(joystick.engaged).toBe(false);
  });

  it('does none of this on a machine without a cursor', () => {
    hoverCapable = false;
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);

    expect(joystick.engaged, 'a synthetic mouse move is not a thumb').toBe(false);
    expect(base.className).not.toContain('joystick__base--hover');
  });

  it('leaves a touch drag alone', () => {
    const { x, y } = centre();
    pointer('pointerdown', x, y, 'touch');
    pointer('pointermove', x + joystick.travel, y, 'touch');
    expect(base.className).not.toContain('joystick__base--hover');

    // Lifting a finger ends the gesture: there is nothing left over the stick
    // to hover with, and no further event coming to let go if it were held.
    pointer('pointerup', x + joystick.travel, y, 'touch');
    expect(joystick.engaged).toBe(false);
    expect(base.className).not.toContain('joystick__base--active');
  });

  it('hands the stick to a drag and takes it back on release', () => {
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);
    expect(base.className).toContain('joystick__base--hover');

    // A press is still a press. The hover mark comes off — a button is down,
    // so this is a drag now — but the stick never goes slack in between.
    pointer('pointerdown', x + joystick.travel, y);
    expect(base.className).not.toContain('joystick__base--hover');
    expect(joystick.engaged).toBe(true);

    // Releasing the button leaves the cursor exactly where it was, and a
    // cursor over the stick is steering it.
    pointer('pointerup', x + joystick.travel, y);
    expect(joystick.engaged, 'a released button is not a lifted thumb').toBe(true);
    expect(base.className).toContain('joystick__base--hover');
  });

  it('goes idle when a drag is released away from the stick', () => {
    const { x, y } = centre();
    pointer('pointerdown', x, y);
    pointer('pointermove', x + 300, y);
    pointer('pointerup', x + 300, y);

    expect(joystick.engaged).toBe(false);
    expect(base.className).not.toContain('joystick__base--active');
  });

  it('drops the cursor on a relayout, as it drops a drag', () => {
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);

    view.resize(PHONE);
    expect(joystick.engaged).toBe(false);
    expect(base.className).not.toContain('joystick__base--hover');
  });

  it('stops answering the cursor once destroyed', () => {
    view.destroy();
    const { x, y } = centre();
    pointer('pointermove', x + joystick.travel, y);

    expect(joystick.engaged).toBe(false);
  });
});

describe('showing what is steering', () => {
  const CENTRED = 'translate(-50%, -50%)';

  it('leans the stick on the key being held', () => {
    frame({ held: Direction.Up, requested: Direction.Up });

    expect(knob.style.transform).toBe(`translate(-50%, -50%) translate(0px, ${-joystick.travel}px)`);
    expect(base.dataset['direction']).toBe('up');
    expect(base.className).toContain('joystick__base--active');
  });

  it('throws the stick all the way, because a key has no half measures', () => {
    frame({ held: Direction.Right, requested: Direction.Right });
    expect(knob.style.transform).toBe(`translate(-50%, -50%) translate(${joystick.travel}px, 0px)`);
  });

  it('springs home when the key comes up', () => {
    frame({ held: Direction.Right, requested: Direction.Right });
    frame({ requested: Direction.Right });

    expect(knob.style.transform).toBe(CENTRED);
    expect(base.className).not.toContain('joystick__base--active');
    // The chevron holds: the key is up but Pac-Man is still going right.
    expect(base.dataset['direction']).toBe('right');
  });

  it('lets a cursor on the stick outrank a held key', () => {
    const { x, y } = centre();
    // Half throw to the left, which a key could never ask for.
    pointer('pointermove', x - joystick.travel / 2, y);
    frame({ held: Direction.Right, requested: Direction.Right });

    expect(knob.style.transform).toBe(
      `translate(-50%, -50%) translate(${-joystick.travel / 2}px, 0px)`,
    );
  });

  it('shows the direction the game was asked for, whatever asked', () => {
    // A swipe on the maze never touches this stick, and the ring is still the
    // only thing on screen saying which way Pac-Man has been sent.
    frame({ requested: Direction.Left });
    expect(base.dataset['direction']).toBe('left');
  });

  it('tints the knob while a turn request waits, and clears when it fires', () => {
    frame({ requested: Direction.Left, buffered: true });
    expect(knob.className).toContain('joystick__knob--buffered');

    frame({ requested: Direction.Left });
    expect(knob.className).not.toContain('joystick__knob--buffered');
  });
});
