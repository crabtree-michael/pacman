// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameLoop, MAX_FRAME_MS, STEP_MS } from '../../src/app/loop';

/**
 * The fixed-timestep driver (architecture §3.1).
 *
 * Driven by a fake clock and a fake `requestAnimationFrame`, so "what happens
 * at 40 fps" is a question this suite can ask directly instead of a thing to
 * hope about. The point of the loop is that the answer is always "the same
 * number of ticks per second as at 120 fps".
 */

class FakeFrames {
  nowMs = 0;
  private readonly pending = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  readonly request = (callback: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.pending.set(id, callback);
    return id;
  };

  readonly cancel = (id: number): void => {
    this.pending.delete(id);
  };

  get scheduled(): number {
    return this.pending.size;
  }

  /** Move the clock on by `deltaMs` and run whatever was scheduled. */
  advance(deltaMs: number): void {
    this.nowMs += deltaMs;
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const callback of due) callback(this.nowMs);
  }
}

let frames: FakeFrames;
let hidden = false;

function setHidden(value: boolean): void {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  frames = new FakeFrames();
  hidden = false;
  vi.stubGlobal('requestAnimationFrame', frames.request);
  vi.stubGlobal('cancelAnimationFrame', frames.cancel);
  vi.spyOn(performance, 'now').mockImplementation(() => frames.nowMs);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Ticks the loop owes for `ms` of elapsed time, accumulated exactly as the loop
 * accumulates it. Spelling it out beats hard-coding a number that a change to
 * `STEP_MS` would silently invalidate.
 */
function ticksIn(ms: number): number {
  let accumulator = ms;
  let ticks = 0;
  while (accumulator >= STEP_MS) {
    accumulator -= STEP_MS;
    ticks++;
  }
  return ticks;
}

function trackedLoop() {
  const steps: number[] = [];
  const alphas: number[] = [];
  const calls: string[] = [];
  const loop = new GameLoop({
    step: (stepMs) => {
      steps.push(stepMs);
      calls.push('step');
    },
    render: (alpha) => {
      alphas.push(alpha);
      calls.push('render');
    },
    onSuspend: () => calls.push('suspend'),
    onResume: () => calls.push('resume'),
  });
  return { loop, steps, alphas, calls };
}

describe('GameLoop', () => {
  // Frame times are whole milliseconds and deliberately off the tick boundary.
  // A frame of exactly `STEP_MS` sits on the knife edge of `>=` and lands on
  // either side of it depending on the accumulated float error — a property of
  // the test's clock, not of the loop.
  it('runs one tick per step-length of elapsed time', () => {
    const { loop, steps } = trackedLoop();
    loop.start();

    frames.advance(17);
    expect(steps).toHaveLength(1);
    // Whatever the frame took, the simulation only ever advances by the step.
    expect(steps[0]).toBe(STEP_MS);

    frames.advance(50);
    expect(steps).toHaveLength(4);
    loop.destroy();
  });

  it('plays at the same speed whatever the frame rate', () => {
    // 990 ms of wall clock, painted at 100 fps and at 33 fps.
    const run = (frameMs: number, frameCount: number) => {
      const tracked = trackedLoop();
      tracked.loop.start();
      for (let i = 0; i < frameCount; i++) frames.advance(frameMs);
      tracked.loop.destroy();
      return tracked;
    };

    const fast = run(10, 99);
    const slow = run(30, 33);

    // The whole point of the fixed timestep: identical simulation either way.
    expect(fast.steps.length).toBe(ticksIn(990));
    expect(slow.steps.length).toBe(fast.steps.length);
    // ...while the fast panel painted three times as often, interpolating
    // between the same ticks (architecture §2.4).
    expect(fast.alphas.length).toBe(99);
    expect(slow.alphas.length).toBe(33);
  });

  it('renders exactly once per frame, after the ticks', () => {
    const { loop, calls } = trackedLoop();
    loop.start();

    frames.advance(STEP_MS * 2.5);
    expect(calls).toEqual(['step', 'step', 'render']);
    loop.destroy();
  });

  it('hands the renderer the leftover fraction of a tick', () => {
    const { loop, alphas } = trackedLoop();
    loop.start();

    frames.advance(STEP_MS * 1.5);
    expect(alphas[0]).toBeCloseTo(0.5, 6);
    loop.destroy();
  });

  it('skips the lost time after a long stall rather than simulating it', () => {
    const { loop, steps } = trackedLoop();
    loop.start();

    // Four seconds of tab restore. Without the clamp this is 240 ticks in one
    // frame, which takes longer than a frame, which makes the next gap bigger
    // still — the spiral of death.
    frames.advance(4000);
    expect(steps.length).toBe(ticksIn(MAX_FRAME_MS));
    expect(steps.length).toBeLessThan(ticksIn(4000));
    loop.destroy();
  });

  it('cancels the frame outright when the tab is backgrounded', () => {
    const { loop, steps, calls } = trackedLoop();
    loop.start();
    frames.advance(17);

    setHidden(true);
    expect(loop.isRunning).toBe(false);
    expect(frames.scheduled).toBe(0);
    expect(calls).toContain('suspend');

    // No background CPU: the clock moved four seconds and nothing ticked.
    const before = steps.length;
    frames.advance(4000);
    expect(steps.length).toBe(before);

    setHidden(false);
    expect(loop.isRunning).toBe(true);
    expect(calls).toContain('resume');

    // And no giant delta on return: the accumulator restarted from zero.
    frames.advance(17);
    expect(steps.length).toBe(before + 1);
    loop.destroy();
  });

  it('does not start a loop the app never started', () => {
    const { loop, calls } = trackedLoop();

    setHidden(true);
    setHidden(false);

    expect(loop.isRunning).toBe(false);
    expect(calls).toEqual([]);
    loop.destroy();
  });

  it('does not restart a loop the app stopped deliberately', () => {
    const { loop } = trackedLoop();
    loop.start();
    loop.stop();

    setHidden(true);
    setHidden(false);
    expect(loop.isRunning).toBe(false);
    loop.destroy();
  });

  it('stops listening once destroyed', () => {
    const { loop, calls } = trackedLoop();
    loop.start();
    loop.destroy();

    setHidden(true);
    expect(calls).not.toContain('suspend');
  });
});
