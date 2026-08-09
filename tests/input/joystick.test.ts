import { describe, expect, it } from 'vitest';
import type { DirectionIntent } from '../../src/input/controller';
import {
  ACCESSIBLE_DEAD_ZONE_FACTOR,
  ACCESSIBLE_SIZE_FACTOR,
  ANGULAR_DEAD_ZONE_DEG,
  DIRECTION_ARC_HALF_DEG,
  JOYSTICK_BASE_PX,
  JOYSTICK_DEAD_ZONE_PX,
  JOYSTICK_DECIDE_MS,
  JOYSTICK_HOVER_MARGIN_PX,
  JOYSTICK_TRAVEL_PX,
  VirtualJoystick,
  snapToCardinal,
} from '../../src/input/joystick';
import { Direction } from '../../src/sim/types';

/**
 * Synthetic pointer sequences asserting the emitted direction (architecture §9,
 * "Input"). `joystick.ts` is deliberately DOM-free, so this runs under plain
 * Node; the DOM half lives in the Playwright smoke test.
 */

/** A drag vector of length 100 at `deg` clockwise from due right (screen axes). */
function drag(deg: number): { dx: number; dy: number } {
  const radians = (deg * Math.PI) / 180;
  return { dx: 100 * Math.cos(radians), dy: 100 * Math.sin(radians) };
}

/** A stick whose ring centre sits where the view would have put it. */
function stickAt(x = 100, y = 100): VirtualJoystick {
  const stick = new VirtualJoystick();
  stick.setOrigin({ x, y });
  return stick;
}

/** The game samples once per simulation tick, and the window is measured in them. */
const TICK_MS = 1000 / 60;
const DECIDE_TICKS = Math.ceil(JOYSTICK_DECIDE_MS / TICK_MS) + 1;

/**
 * Tick the stick across a whole decide window and hand back what it committed
 * to, the way the loop would.
 *
 * The *first* direction of a gesture has to be asked for on every tick of that
 * window before it is taken at its word (§3.2), so a fresh press does not
 * answer on the tick it lands — nearly every case below has to hold the thumb
 * still for a moment to get an answer at all, exactly as a player does.
 */
function settle(stick: VirtualJoystick, startMs = 0): DirectionIntent | null {
  let intent: DirectionIntent | null = null;
  for (let i = 0; i < DECIDE_TICKS; i++) intent ??= stick.sample(startMs + i * TICK_MS);
  return intent;
}

/** Where `settle` leaves the clock, so a test can carry on ticking from there. */
const SETTLED_MS = DECIDE_TICKS * TICK_MS;

describe('snapToCardinal', () => {
  it('snaps a drag along an axis to that direction', () => {
    expect(snapToCardinal(40, 0)).toBe(Direction.Right);
    expect(snapToCardinal(-40, 0)).toBe(Direction.Left);
    expect(snapToCardinal(0, 40)).toBe(Direction.Down);
    expect(snapToCardinal(0, -40)).toBe(Direction.Up);
  });

  it('accepts a lean of up to 22.5° off the axis', () => {
    for (const deg of [-22, -10, 0, 10, 22]) {
      const { dx, dy } = drag(deg);
      expect(snapToCardinal(dx, dy), `${deg}° should still read as Right`).toBe(Direction.Right);
    }
  });

  it('emits nothing in the 45° wedge straddling a diagonal', () => {
    // 23°..67° is the wedge between Right and Down: ambiguous, so neither.
    for (const deg of [23, 30, 45, 60, 67]) {
      const { dx, dy } = drag(deg);
      expect(snapToCardinal(dx, dy), `${deg}° should read as no direction`).toBe(Direction.None);
    }
  });

  it('leaves no direction owning a diagonal', () => {
    expect(snapToCardinal(50, 50)).toBe(Direction.None);
    expect(snapToCardinal(-50, 50)).toBe(Direction.None);
    expect(snapToCardinal(50, -50)).toBe(Direction.None);
    expect(snapToCardinal(-50, -50)).toBe(Direction.None);
  });

  it('covers all four wedges around the circle', () => {
    for (const boundary of [45, 135, 225, 315]) {
      for (const offset of [-20, 0, 20]) {
        const { dx, dy } = drag(boundary + offset);
        expect(snapToCardinal(dx, dy), `${boundary + offset}° is in a dead wedge`).toBe(
          Direction.None,
        );
      }
    }
  });

  it('reads a zero-length vector as no direction', () => {
    expect(snapToCardinal(0, 0)).toBe(Direction.None);
  });

  it('keeps the documented arcs', () => {
    expect(ANGULAR_DEAD_ZONE_DEG).toBe(45);
    expect(DIRECTION_ARC_HALF_DEG).toBe(22.5);
  });
});

describe('VirtualJoystick', () => {
  it('emits nothing while the thumb is inside the dead zone', () => {
    const stick = stickAt();
    stick.press({ x: 105, y: 100 }); // 5px, inside the 12px dead zone.
    expect(stick.sample(0)).toBeNull();
  });

  it('emits an intent once, not on every tick it is held', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });

    expect(settle(stick)).toEqual({
      dir: Direction.Right,
      timestamp: expect.any(Number),
      source: 'joystick',
    });
    expect(stick.sample(SETTLED_MS)).toBeNull();
  });

  it('measures the drag from the static origin, not from the touch point', () => {
    const stick = stickAt();
    // Landing left of the ring is a Left request and nothing else: the base
    // does not follow the thumb, so the press itself carries a direction and
    // holding it there is all the agreement the window is looking for.
    stick.press({ x: 40, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Left);
  });

  it('emits nothing for a drag into a dead wedge, keeping the latch', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);

    stick.move({ x: 140, y: 140 }); // 45°: ambiguous between Right and Down.
    expect(stick.sample(SETTLED_MS)).toBeNull();

    stick.move({ x: 100, y: 140 }); // Committed to Down at last.
    expect(stick.sample(SETTLED_MS + TICK_MS)?.dir).toBe(Direction.Down);
  });

  it('stops the knob at the end of its throw, however far the thumb goes', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 500, y: 0 });
    expect(stick.knobOffset()).toEqual({ x: stick.travel, y: 0 });

    // Twice as far again is still the end of the slot: the gate has no more.
    stick.move({ x: 1000, y: 0 });
    expect(stick.knobOffset()).toEqual({ x: stick.travel, y: 0 });
  });

  it('runs the knob along one axis, never between them', () => {
    const stick = stickAt(0, 0);
    // 20° off the axis: still a Right, and the knob shows a Right and nothing
    // else. The 7px of drift the raw vector carries is not the knob's to show.
    const { dx, dy } = drag(20);
    stick.press({ x: dx, y: dy });

    const offset = stick.knobOffset()!;
    expect(offset.y).toBe(0);
    expect(offset.x).toBe(stick.travel);
  });

  it('reports a part-pushed stick as part of the way down its slot', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 20, y: 0 }); // Past the 12px dead zone, short of the throw.
    expect(stick.knobOffset()).toEqual({ x: 20, y: 0 });
  });

  it('holds the knob in the latched slot through a dead wedge', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 100, y: 0 });
    settle(stick);
    expect(stick.knobOffset()).toEqual({ x: stick.travel, y: 0 });

    // A thumb wandering onto the diagonal does not drop the stick out of its
    // gate; it slackens, because only its Rightward reach still counts.
    stick.move({ x: 20, y: 20 });
    expect(stick.sample(SETTLED_MS)).toBeNull();
    expect(stick.knobOffset()).toEqual({ x: 20, y: 0 });
  });

  it('rests the knob at centre for a wedge drag with nothing latched', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 50, y: 50 }); // A perfect diagonal, and no slot to be in.
    expect(stick.knobOffset()).toEqual({ x: 0, y: 0 });
  });

  it('sends the knob home the moment the thumb lifts', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 100, y: 0 });
    settle(stick);
    expect(stick.knobOffset()).not.toBeNull();

    // Null is the view's cue to animate back to centre. The latch is untouched:
    // Pac-Man keeps walking while the stick springs back under him.
    stick.release();
    expect(stick.knobOffset()).toBeNull();
    expect(stick.snapped).toBe(Direction.Right);
  });

  it('measures the raw drag for the view, whatever the knob is doing', () => {
    const stick = stickAt(0, 0);
    expect(stick.dragDistance).toBe(0); // Nothing down.

    stick.press({ x: 30, y: 40 });
    expect(stick.dragDistance).toBe(50); // A drag, though the knob barely moved.

    stick.release();
    expect(stick.dragDistance).toBe(0);
  });

  it('scales the dead zone and radius with the screen', () => {
    const stick = new VirtualJoystick();
    const baseDeadZone = stick.deadZone;
    stick.setScale(2);
    expect(stick.deadZone).toBe(baseDeadZone * 2);
  });

  it('keeps the latch when the thumb lifts, as an arcade stick would', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);

    stick.release();
    expect(stick.sample(SETTLED_MS)).toBeNull(); // No new intent — no "stop" either.

    // Re-pressing and pushing the same way is not a change, so it stays quiet.
    stick.press({ x: 140, y: 100 });
    expect(settle(stick, SETTLED_MS + TICK_MS)).toBeNull();
  });

  it('reports the snapped direction for the ring chevron', () => {
    const stick = stickAt();
    expect(stick.snapped).toBe(Direction.None);

    stick.press({ x: 100, y: 40 });
    settle(stick);

    // The chevron shows the quantised direction; the knob shows how far up its
    // slot the thumb has pushed (spec §3.2).
    expect(stick.snapped).toBe(Direction.Up);
    expect(stick.knobOffset()).toEqual({ x: 0, y: -stick.travel });
  });

  it('holds the chevron through a dead wedge rather than blanking it', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    settle(stick);

    stick.move({ x: 140, y: 140 }); // Into the wedge.
    stick.sample(SETTLED_MS);

    // Pac-Man is still walking right, so that is what the ring keeps showing.
    expect(stick.snapped).toBe(Direction.Right);
  });

  it('knows whether a thumb is down', () => {
    const stick = stickAt();
    expect(stick.engaged).toBe(false);

    stick.press({ x: 10, y: 10 });
    expect(stick.engaged).toBe(true);

    stick.release();
    expect(stick.engaged).toBe(false);
    // Released, but still latched: the ring keeps showing where he is headed.
    expect(stick.snapped).toBe(Direction.None);
  });

  it('drops the latch on reset without letting go of the stick', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);

    stick.reset();
    expect(stick.snapped).toBe(Direction.None);
    expect(stick.engaged).toBe(true);
    // The thumb is still there, so the very next tick re-reports it.
    expect(stick.sample(SETTLED_MS)?.dir).toBe(Direction.Right);
  });
});

/**
 * The window a fresh gesture gets before its direction is committed.
 *
 * The bug it exists for: a swipe meant for Right that leaves the ring centre
 * pointing up — a thumb rolls off its knuckle before it travels — used to latch
 * Up off the first sample past the dead zone, and the turn buffer had it before
 * the swipe was half done.
 */
describe('deciding which way a fresh drag is going (product spec §3.2)', () => {
  it('holds the first direction of a gesture until it has been asked for throughout', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 }); // Unambiguously Right, from the press on.

    expect(stick.sample(0), 'the tick the thumb landed on').toBeNull();
    expect(stick.sample(JOYSTICK_DECIDE_MS / 2)).toBeNull();
    expect(stick.sample(JOYSTICK_DECIDE_MS - 1)).toBeNull();
    expect(stick.sample(JOYSTICK_DECIDE_MS)?.dir).toBe(Direction.Right);
  });

  it('never emits the direction a swipe was only passing through', () => {
    const stick = stickAt();

    // Straight up out of the ring: 30 px, well past the dead zone and well
    // inside the Up arc. This is the sample the old code latched.
    stick.press({ x: 100, y: 70 });
    expect(stick.sample(0)).toBeNull();
    expect(stick.sample(16)).toBeNull();
    expect(stick.sample(32)).toBeNull();

    // The wrist takes over and the swipe turns out to have been a Right all
    // along. It crosses a wedge on the way, which says nothing either way.
    stick.move({ x: 130, y: 85 });
    expect(stick.sample(48)).toBeNull();
    stick.move({ x: 150, y: 95 });
    expect(stick.sample(64), 'a fresh direction starts the clock again').toBeNull();
    expect(stick.sample(64 + JOYSTICK_DECIDE_MS)?.dir).toBe(Direction.Right);

    // The whole point: Up was never asked for, so Pac-Man was never sent up.
    expect(stick.snapped).toBe(Direction.Right);
  });

  it('takes a wedge as neither agreement nor disagreement', () => {
    const stick = stickAt();
    stick.press({ x: 100, y: 70 }); // Up.
    expect(stick.sample(0)).toBeNull();

    // A thumb that wobbles onto a diagonal mid-window has not changed its mind,
    // it has stopped saying anything for a tick. Restarting the window on that
    // would leave a shaky hand unable to commit to anything at all.
    stick.move({ x: 115, y: 85 });
    expect(stick.sample(16)).toBeNull();

    stick.move({ x: 100, y: 70 });
    expect(stick.sample(JOYSTICK_DECIDE_MS)?.dir).toBe(Direction.Up);
  });

  it('turns instantly once the gesture has declared itself', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);

    // A thumb already steering is not forming a gesture, it is playing. The
    // next direction lands on the tick it is read — this is where cornering
    // happens, and where a delay is the thing a player would actually feel.
    stick.move({ x: 100, y: 60 });
    expect(stick.sample(SETTLED_MS)?.dir).toBe(Direction.Up);
  });

  it('gives every fresh grab of the stick its own window', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);
    stick.release();

    // No credit carried over from how decisively the last gesture ended.
    stick.press({ x: 100, y: 60 });
    expect(stick.sample(SETTLED_MS)).toBeNull();
    expect(stick.sample(SETTLED_MS + JOYSTICK_DECIDE_MS)?.dir).toBe(Direction.Up);
  });

  it('honours a flick that let go before the window was out', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(stick.sample(0)).toBeNull();

    // A stab at a direction is over in less time than the window: the lift is
    // the end of the evidence, not the loss of it, so the stick takes the
    // reading it was let go on rather than throwing the gesture away.
    stick.release();
    expect(stick.sample(16)?.dir).toBe(Direction.Right);
    expect(stick.sample(32), 'and only the once').toBeNull();
  });

  it('reads a flick from where it was let go, not from where it wandered', () => {
    const stick = stickAt();
    stick.press({ x: 100, y: 60 }); // Up...
    expect(stick.sample(0)).toBeNull();

    stick.move({ x: 140, y: 100 }); // ...and away to the right before lifting.
    stick.release();
    expect(stick.sample(16)?.dir).toBe(Direction.Right);
  });

  it('lets go of a flick that never left the dead zone', () => {
    const stick = stickAt();
    stick.press({ x: 105, y: 100 }); // A tap, in the slack around centre.
    expect(stick.sample(0)).toBeNull();

    stick.release();
    expect(stick.sample(16)).toBeNull();
  });

  it('drops a flick the reset was meant to forget', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(stick.sample(0)).toBeNull();
    stick.release();

    // The flick is a request from before the death that triggered the reset.
    // Honouring it a tick later is the respawn-into-a-ghost reset prevents.
    stick.reset();
    expect(stick.sample(16)).toBeNull();
  });

  it('moves the knob while it is still making its mind up', () => {
    const stick = stickAt(0, 0);
    stick.press({ x: 20, y: 0 });
    expect(stick.sample(0), 'nothing latched yet').toBeNull();

    // The visible response to a thumb is not what is being deferred: the knob
    // is already down its slot, and only the chevron waits for the decision.
    expect(stick.knobOffset()).toEqual({ x: 20, y: 0 });
    expect(stick.snapped).toBe(Direction.None);
  });

  it('re-reports a held stick after a reset without waiting again', () => {
    const stick = stickAt();
    stick.press({ x: 140, y: 100 });
    expect(settle(stick)?.dir).toBe(Direction.Right);

    // The thumb has not moved, so there is nothing left to weigh up: a respawn
    // must not stand still for another window working out an answer it has.
    stick.reset();
    expect(stick.sample(SETTLED_MS)?.dir).toBe(Direction.Right);
  });
});

describe('accessibility sizing (product spec §3.4)', () => {
  it('leaves the geometry at spec values by default', () => {
    const stick = new VirtualJoystick();
    expect(stick.sizeScale).toBe(1);
    expect(stick.deadZone).toBe(JOYSTICK_DEAD_ZONE_PX);
    expect(stick.travel).toBe(JOYSTICK_TRAVEL_PX);
  });

  it('enlarges the stick by 1.5x', () => {
    const stick = new VirtualJoystick();
    stick.setAccessible(true);

    expect(stick.accessibilityFactor).toBe(ACCESSIBLE_SIZE_FACTOR);
    expect(stick.travel).toBe(JOYSTICK_TRAVEL_PX * ACCESSIBLE_SIZE_FACTOR);
  });

  it('widens the dead zone by more than the enlargement alone would', () => {
    const stick = new VirtualJoystick();
    const proportional = stick.deadZone * ACCESSIBLE_SIZE_FACTOR;
    stick.setAccessible(true);

    expect(stick.deadZone).toBe(proportional * ACCESSIBLE_DEAD_ZONE_FACTOR);
    // Standard mode spends a third of the throw on the dead zone; accessible
    // mode spends more, which is the whole point of widening it separately.
    expect(stick.deadZone / stick.travel).toBeGreaterThan(
      JOYSTICK_DEAD_ZONE_PX / JOYSTICK_TRAVEL_PX,
    );
  });

  it('compounds with the screen scale rather than replacing it', () => {
    const stick = new VirtualJoystick();
    stick.setScale(1.25);
    stick.setAccessible(true);
    expect(stick.sizeScale).toBe(1.25 * ACCESSIBLE_SIZE_FACTOR);
  });

  it('lets a thumb rest further from centre before it registers a turn', () => {
    const stick = stickAt();
    stick.setAccessible(true);
    // 20px would clear the standard 12px dead zone, but not the widened one.
    stick.press({ x: 120, y: 100 });

    expect(stick.sample(0)).toBeNull();
  });

  it('grows the area a cursor steers from with the stick', () => {
    const stick = stickAt();
    const standard = stick.hoverRadius;
    stick.setAccessible(true);

    expect(stick.hoverRadius).toBe(standard * ACCESSIBLE_SIZE_FACTOR);
  });
});

/**
 * The area a hovering cursor steers from (product spec §3.3). Geometry only:
 * whether an event ever reaches it is `joystick-view`'s business, and the media
 * query that decides whether any of this happens at all is tested there.
 */
describe('hover area', () => {
  it('reaches a knob-radius past the rim of the ring', () => {
    const stick = stickAt();
    expect(stick.hoverRadius).toBe(JOYSTICK_BASE_PX / 2 + JOYSTICK_HOVER_MARGIN_PX);
  });

  it('holds a cursor pushing the stick to its stop and beyond', () => {
    const stick = stickAt();
    // Full throw is 36 px out; the rim is at 64. Neither is anywhere near
    // losing control, which is the point of measuring the area from the rim.
    expect(stick.withinHoverArea({ x: 100 + JOYSTICK_TRAVEL_PX, y: 100 })).toBe(true);
    expect(stick.withinHoverArea({ x: 100 + JOYSTICK_BASE_PX / 2, y: 100 })).toBe(true);
  });

  it('lets go of a cursor that has left it', () => {
    const stick = stickAt();
    expect(stick.withinHoverArea({ x: 100 + stick.hoverRadius + 1, y: 100 })).toBe(false);
    // Diagonally out: the area is a disc, so the corners of its box are outside.
    expect(stick.withinHoverArea({ x: 100 + stick.hoverRadius, y: 100 + 1 })).toBe(false);
  });

  it('measures from the ring, wherever the ring has been put', () => {
    const stick = stickAt(400, 300);
    expect(stick.withinHoverArea({ x: 400, y: 300 })).toBe(true);
    expect(stick.withinHoverArea({ x: 100, y: 100 })).toBe(false);
  });
});

describe('throwOffset', () => {
  it('puts the knob at the end of the slot a key is holding', () => {
    const stick = stickAt();
    expect(stick.throwOffset(Direction.Up)).toEqual({ x: 0, y: -JOYSTICK_TRAVEL_PX });
    expect(stick.throwOffset(Direction.Right)).toEqual({ x: JOYSTICK_TRAVEL_PX, y: 0 });
  });

  it('is nothing at all for no direction, so the knob goes home', () => {
    expect(stickAt().throwOffset(Direction.None)).toBeNull();
  });

  it('throws to the enlarged stop in accessible mode', () => {
    const stick = stickAt();
    stick.setAccessible(true);
    expect(stick.throwOffset(Direction.Left)).toEqual({ x: -stick.travel, y: 0 });
  });
});
