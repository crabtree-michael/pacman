import { describe, expect, it } from 'vitest';
import { InputController, type DirectionIntent, type InputSource } from '../../src/input/controller';
import { VirtualJoystick } from '../../src/input/joystick';
import { Direction } from '../../src/sim/types';

/**
 * Arbitration and latching (architecture §4.3). The controller is the piece
 * that makes joystick, swipe, keyboard, gamepad and a recorded replay stream
 * interchangeable, so it is tested against a stub source rather than any real
 * one.
 */

/** A source that reports whatever it is told to, and remembers being reset. */
class StubSource implements InputSource {
  next: DirectionIntent | null = null;
  resets = 0;
  destroyed = 0;

  constructor(readonly name: string) {}

  sample(): DirectionIntent | null {
    const intent = this.next;
    this.next = null;
    return intent;
  }

  reset(): void {
    this.resets++;
  }

  destroy(): void {
    this.destroyed++;
  }
}

function intent(source: string, dir: Direction, timestamp: number): DirectionIntent {
  return { dir, timestamp, source };
}

describe('InputController', () => {
  it('starts with no direction requested', () => {
    expect(new InputController().snapshot()).toEqual({ dir: Direction.None, serial: 0 });
  });

  it('latches an intent and bumps the serial so the sim re-arms its buffer', () => {
    const source = new StubSource('stub');
    const controller = new InputController().use(source);

    source.next = intent('stub', Direction.Left, 10);
    controller.sample(10);

    expect(controller.snapshot()).toEqual({ dir: Direction.Left, serial: 1 });
  });

  it('holds the latch when every source falls silent', () => {
    const source = new StubSource('stub');
    const controller = new InputController().use(source);

    source.next = intent('stub', Direction.Up, 0);
    controller.sample(0);
    controller.sample(16);
    controller.sample(32);

    // Pac-Man keeps going: a quiet source is not a request to stop (spec §3.2).
    expect(controller.snapshot()).toEqual({ dir: Direction.Up, serial: 1 });
  });

  it('lets a second source take over mid-game', () => {
    const stick = new StubSource('joystick');
    const keys = new StubSource('keyboard');
    const controller = new InputController().use(stick).use(keys);

    stick.next = intent('joystick', Direction.Left, 0);
    controller.sample(0);
    expect(controller.direction).toBe(Direction.Left);

    keys.next = intent('keyboard', Direction.Up, 16);
    controller.sample(16);
    expect(controller.direction).toBe(Direction.Up);
  });

  it('ignores an intent older than the one already latched', () => {
    const fresh = new StubSource('fresh');
    const stale = new StubSource('stale');
    const controller = new InputController().use(fresh).use(stale);

    fresh.next = intent('fresh', Direction.Right, 100);
    stale.next = intent('stale', Direction.Down, 40);
    controller.sample(100);

    expect(controller.direction).toBe(Direction.Right);
  });

  it('never latches None, so a source cannot stop Pac-Man by reporting it', () => {
    const source = new StubSource('stub');
    const controller = new InputController().use(source);

    source.next = intent('stub', Direction.Right, 0);
    controller.sample(0);
    source.next = intent('stub', Direction.None, 16);
    controller.sample(16);

    expect(controller.snapshot()).toEqual({ dir: Direction.Right, serial: 1 });
  });

  it('clears its own latch on reset', () => {
    const source = new StubSource('stub');
    const controller = new InputController().use(source);

    source.next = intent('stub', Direction.Down, 0);
    controller.sample(0);
    controller.reset();

    expect(controller.direction).toBe(Direction.None);
  });

  it('clears the sources on reset too', () => {
    const source = new StubSource('stub');
    new InputController().use(source).reset();
    expect(source.resets).toBe(1);
  });

  /**
   * The regression this exists for: a source only speaks on *change*, so a
   * controller that reset itself without resetting its sources left a stick the
   * player was still holding unable to report itself. Pac-Man would stand still
   * after a respawn with the thumb visibly pushed sideways, until the player
   * flicked some *other* direction.
   */
  it('a still-held stick steers again immediately after a reset', () => {
    const stick = new VirtualJoystick();
    stick.setOrigin({ x: 100, y: 100 }); // Where the view pins the static ring.
    const controller = new InputController().use(stick);

    stick.press({ x: 160, y: 100 });
    // A fresh gesture is read across a short window before it commits, so it
    // takes a few ticks of a held thumb to get a direction out of the stick at
    // all (product spec §3.2, and `joystick.test.ts` for the window itself).
    for (let t = 0; t <= 100; t += 16) controller.sample(t);
    expect(controller.direction).toBe(Direction.Right);

    controller.reset();
    expect(controller.direction).toBe(Direction.None);

    // Thumb never moved, and the gesture has already declared itself once, so
    // the next tick must pick it straight back up.
    controller.sample(116);
    expect(controller.direction).toBe(Direction.Right);
  });

  it('a released stick stays cleared after a reset', () => {
    const stick = new VirtualJoystick();
    stick.setOrigin({ x: 100, y: 100 }); // Where the view pins the static ring.
    const controller = new InputController().use(stick);

    stick.press({ x: 160, y: 100 });
    controller.sample(0);
    stick.release();

    controller.reset();
    controller.sample(16);

    // Nothing is being asked for, so the respawn does not walk into a ghost.
    expect(controller.direction).toBe(Direction.None);
  });

  it('destroys every source once', () => {
    const a = new StubSource('a');
    const b = new StubSource('b');
    const controller = new InputController().use(a).use(b);

    controller.destroy();
    controller.destroy();

    expect([a.destroyed, b.destroyed]).toEqual([1, 1]);
  });
});
