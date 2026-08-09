import { beforeEach, describe, expect, it } from 'vitest';
import { SWIPE_MIN_PX, SwipeInput } from '../../src/input/swipe';
import { Direction } from '../../src/sim/types';

/**
 * Swipe-to-steer (product spec §3.3). Needs a DOM because the whole point of
 * the source is the pointer plumbing; the threshold maths it does in `sample`
 * is checked through that plumbing rather than around it.
 */

let surface: HTMLElement;
let swipe: SwipeInput;

/** jsdom has no PointerEvent, and no pointer capture to go with it. */
function pointer(type: string, x: number, y: number, pointerId = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event &
    Record<string, unknown>;
  event['pointerId'] = pointerId;
  event['clientX'] = x;
  event['clientY'] = y;
  surface.dispatchEvent(event);
}

beforeEach(() => {
  surface = document.createElement('div');
  // Capture is a no-op here; the source only has to not crash without it.
  surface.setPointerCapture = (): void => {};
  surface.hasPointerCapture = (): boolean => false;
  surface.releasePointerCapture = (): void => {};
  document.body.append(surface);
  swipe = new SwipeInput(surface);
});

describe('SwipeInput', () => {
  it('ignores a drag that never clears the flick threshold', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100 + SWIPE_MIN_PX - 1, 100);
    expect(swipe.sample(0)).toBeNull();
  });

  it('emits one request the moment the flick clears the threshold', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100 + SWIPE_MIN_PX + 1, 100);

    expect(swipe.sample(5)).toEqual({ dir: Direction.Right, timestamp: 5, source: 'swipe' });
  });

  it('emits only once per flick, however far it carries on', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    expect(swipe.sample(0)?.dir).toBe(Direction.Right);

    // Still dragging, now well past the threshold in the same direction.
    pointer('pointermove', 300, 100);
    expect(swipe.sample(16)).toBeNull();
  });

  it('reports a flick that started and finished inside one frame', () => {
    // A flick is fast, and no tick necessarily lands between the finger moving
    // and it lifting. Discarding the gesture on release would silently drop the
    // quickest swipes — the ones players make most.
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);

    expect(swipe.sample(0)?.dir).toBe(Direction.Right);
  });

  it('reports a lifted flick only once', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);

    expect(swipe.sample(0)?.dir).toBe(Direction.Right);
    expect(swipe.sample(16)).toBeNull();
  });

  it('does not resurrect a lifted tap that never cleared the threshold', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 110, 100);
    pointer('pointerup', 110, 100);

    expect(swipe.sample(0)).toBeNull();
    expect(swipe.sample(16)).toBeNull();
  });

  it('lets a new flick displace one that has not been read yet', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100); // Rightward, lifted, never sampled.
    pointer('pointerup', 200, 100);

    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 200); // Downward, and more recent.

    expect(swipe.sample(0)?.dir).toBe(Direction.Down);
  });

  it('ignores a stray move after the finger has lifted', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    pointer('pointerup', 200, 100);
    pointer('pointermove', 100, 200); // Same id, but the gesture is over.

    expect(swipe.sample(0)?.dir).toBe(Direction.Right);
  });

  it('starts a fresh flick after the finger lifts', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    expect(swipe.sample(0)?.dir).toBe(Direction.Right);
    pointer('pointerup', 200, 100);

    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 200);
    expect(swipe.sample(32)?.dir).toBe(Direction.Down);
  });

  it('snaps a diagonal flick to its dominant axis', () => {
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 60, 130); // 40 left, 30 down.
    expect(swipe.sample(0)?.dir).toBe(Direction.Left);
  });

  it('reports nothing once the setting turns it off', () => {
    swipe.setEnabled(false);
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    expect(swipe.sample(0)).toBeNull();
  });

  it('measures the flick from where it started, not from the last move', () => {
    // Three small moves that each fall short but together clear the threshold.
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 110, 100);
    expect(swipe.sample(0)).toBeNull();
    pointer('pointermove', 120, 100);
    expect(swipe.sample(16)).toBeNull();
    pointer('pointermove', 130, 100);
    expect(swipe.sample(32)?.dir).toBe(Direction.Right);
  });

  it('detaches its handlers on destroy', () => {
    swipe.destroy();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    expect(swipe.sample(0)).toBeNull();
  });
});
