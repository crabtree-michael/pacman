import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyboardInput } from '../../src/input/keyboard';
import { Direction } from '../../src/sim/types';

/**
 * Arrow keys and WASD (product spec §3.3), and the held state the on-screen
 * stick is drawn from. Needs a DOM because the source is nothing but key
 * plumbing; jsdom has real `KeyboardEvent`s, so nothing here is faked.
 */

let target: EventTarget;
let keyboard: KeyboardInput;

function down(code: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { code, cancelable: true, repeat });
  target.dispatchEvent(event);
  return event;
}

function up(code: string): void {
  target.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

beforeEach(() => {
  target = new EventTarget();
  keyboard = new KeyboardInput(target);
});

afterEach(() => keyboard.destroy());

describe('KeyboardInput', () => {
  it('steers with the arrow keys', () => {
    down('ArrowLeft');
    expect(keyboard.sample(0)).toEqual({ dir: Direction.Left, timestamp: 0, source: 'keyboard' });
  });

  it('steers with WASD', () => {
    down('KeyW');
    expect(keyboard.sample(0)?.dir).toBe(Direction.Up);
  });

  it('ignores keys that are not steering keys', () => {
    const event = down('Space');
    expect(keyboard.sample(0)).toBeNull();
    expect(event.defaultPrevented, 'a key the game does not use is the page’s').toBe(false);
  });

  it('stops the page acting on a key it has taken', () => {
    // Arrow keys scroll; the game surface is fixed, but the browser does not
    // know that and the spec has nothing on screen ever move (§2.4).
    expect(down('ArrowDown').defaultPrevented).toBe(true);
  });

  it('reports a press once, not on every tick it is held', () => {
    down('ArrowRight');
    expect(keyboard.sample(0)?.dir).toBe(Direction.Right);
    expect(keyboard.sample(16)).toBeNull();
  });

  it('takes a second press of a key already latched as a fresh request', () => {
    // Not the gamepad's rule: a key is an event, and something else may have
    // steered in between, so pressing it again has to mean something.
    down('ArrowRight');
    expect(keyboard.sample(0)?.dir).toBe(Direction.Right);
    up('ArrowRight');

    down('ArrowRight');
    expect(keyboard.sample(16)?.dir).toBe(Direction.Right);
  });

  it('keeps the latch when the key comes up, as the stick does', () => {
    down('ArrowRight');
    expect(keyboard.sample(0)?.dir).toBe(Direction.Right);

    up('ArrowRight');
    expect(keyboard.sample(16), 'releasing is not a request to stop').toBeNull();
  });

  it('says nothing new while the key repeats', () => {
    down('ArrowUp');
    expect(keyboard.sample(0)?.dir).toBe(Direction.Up);
    down('ArrowUp', true);
    expect(keyboard.sample(16)).toBeNull();
  });

  describe('what the stick is drawn from', () => {
    it('is nothing at all with no key down', () => {
      expect(keyboard.direction).toBe(Direction.None);
    });

    it('is the key being held', () => {
      down('KeyD');
      expect(keyboard.direction).toBe(Direction.Right);
    });

    it('goes home when the key comes up', () => {
      down('KeyD');
      up('KeyD');
      expect(keyboard.direction).toBe(Direction.None);
    });

    it('follows the newer of two keys held at once', () => {
      down('ArrowRight');
      down('ArrowUp');
      expect(keyboard.direction).toBe(Direction.Up);
    });

    it('falls back to the key still down, and steers back with it', () => {
      down('ArrowRight');
      expect(keyboard.sample(0)?.dir).toBe(Direction.Right);
      down('ArrowUp');
      expect(keyboard.sample(16)?.dir).toBe(Direction.Up);

      // Letting go of Up with Right still held is a request for Right: the
      // hand is asking for it and the stick is about to show it.
      up('ArrowUp');
      expect(keyboard.direction).toBe(Direction.Right);
      expect(keyboard.sample(32)?.dir).toBe(Direction.Right);
    });

    it('survives the key repeating', () => {
      down('ArrowUp');
      down('ArrowUp', true);
      down('ArrowUp', true);
      expect(keyboard.direction).toBe(Direction.Up);
      up('ArrowUp');
      expect(keyboard.direction, 'one keyup ends one held key').toBe(Direction.None);
    });

    it('lets go of everything when the window loses focus', () => {
      // The keyup lands on whatever took the focus, never on this window, so
      // without this the stick would lean for ever.
      down('ArrowLeft');
      target.dispatchEvent(new Event('blur'));
      expect(keyboard.direction).toBe(Direction.None);
    });
  });

  describe('reset', () => {
    it('says a held key again, the way a held stick re-reports itself', () => {
      down('ArrowLeft');
      expect(keyboard.sample(0)?.dir).toBe(Direction.Left);

      keyboard.reset();
      expect(keyboard.sample(16)?.dir).toBe(Direction.Left);
    });

    it('has nothing to say when the key is already up', () => {
      down('ArrowLeft');
      expect(keyboard.sample(0)?.dir).toBe(Direction.Left);
      up('ArrowLeft');

      keyboard.reset();
      expect(keyboard.sample(16)).toBeNull();
    });

    it('drops a press the reset was meant to forget', () => {
      down('ArrowLeft');
      up('ArrowLeft'); // Pressed and released between two ticks, never read.

      keyboard.reset();
      expect(keyboard.sample(0)).toBeNull();
    });
  });

  it('detaches its handlers on destroy', () => {
    keyboard.destroy();
    down('ArrowLeft');

    expect(keyboard.sample(0)).toBeNull();
    expect(keyboard.direction).toBe(Direction.None);
  });
});
