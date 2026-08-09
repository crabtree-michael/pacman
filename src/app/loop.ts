/**
 * Fixed-timestep driver (architecture §3.1).
 *
 * The simulation always advances in whole `STEP_MS` ticks, so a device
 * dropping to 40 fps plays at the same speed rather than in slow motion, and a
 * 120 Hz panel renders twice per tick with interpolation carrying the
 * difference (product spec §6).
 */

export const STEP_MS = 1000 / 60;

/**
 * Ceiling on the time one frame may contribute. After a long stall — tab
 * restore, GC pause — the game skips the lost time instead of trying to
 * simulate seconds of it in one frame ("spiral of death").
 */
export const MAX_FRAME_MS = 250;

export interface LoopHooks {
  /** Advance the simulation by exactly one tick. */
  step(stepMs: number): void;
  /** Draw; `alpha` is the leftover accumulator fraction, in [0, 1). */
  render(alpha: number): void;
  /** Called when the tab is backgrounded and the loop suspends. */
  onSuspend?(): void;
  /**
   * Called when the tab comes back and the loop restarts. The game does not
   * resume with it — returning shows the pause overlay rather than dropping the
   * player back into a moving Pac-Man (product spec §4.6).
   */
  onResume?(): void;
}

/**
 * How many frames of timings to keep.
 *
 * Four seconds at 60 Hz — long enough for a percentile to mean something,
 * short enough that a stall two minutes ago is not still being reported.
 */
const SAMPLE_WINDOW = 240;

/** What one frame cost, and what the display gave it (product spec §6). */
export interface FrameStats {
  /** Frames measured since the loop started. */
  frames: number;
  /** Milliseconds of simulation plus render, per frame. */
  work: readonly number[];
  /** Milliseconds between consecutive frames — the display's own pace. */
  intervals: readonly number[];
}

/** Append to a fixed-length ring, oldest out. */
function push(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_WINDOW) samples.shift();
}

export class GameLoop {
  private rafId: number | null = null;
  private lastMs = 0;
  private accumulator = 0;
  /** Whether the *tab* stopped this loop, as opposed to the app. */
  private suspended = false;

  private frames = 0;
  private readonly work: number[] = [];
  private readonly intervals: number[] = [];

  constructor(private readonly hooks: LoopHooks) {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  get isRunning(): boolean {
    return this.rafId !== null;
  }

  start(): void {
    this.suspended = false;
    if (this.rafId !== null) return;
    this.lastMs = performance.now();
    this.accumulator = 0;
    // A resumed loop's first interval spans however long the tab was away, and
    // reporting that as a dropped frame would be a lie about the game's pace.
    this.clearStats();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.suspended = false;
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stop();
  }

  /**
   * The last few frames' timings (product spec §6).
   *
   * Two `performance.now()` calls a frame, always on, because a frame budget
   * nobody can read is a frame budget nobody checks. `app/stats.ts` puts it on
   * screen behind `?stats`, and the browser tests assert against it.
   */
  get stats(): FrameStats {
    return { frames: this.frames, work: this.work, intervals: this.intervals };
  }

  private readonly frame = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const delta = Math.min(nowMs - this.lastMs, MAX_FRAME_MS);
    const interval = nowMs - this.lastMs;
    this.lastMs = nowMs;
    this.accumulator += delta;

    const started = performance.now();
    while (this.accumulator >= STEP_MS) {
      this.hooks.step(STEP_MS);
      this.accumulator -= STEP_MS;
    }

    this.hooks.render(this.accumulator / STEP_MS);

    // The first frame has no predecessor to be an interval from, and its work
    // includes whatever the browser was still doing at start-up.
    if (this.frames > 0) {
      push(this.work, performance.now() - started);
      push(this.intervals, interval);
    }
    this.frames++;
  };

  /**
   * Backgrounding cancels the RAF outright rather than letting it throttle:
   * no background CPU, no battery drain, and no giant delta on return.
   *
   * Only a loop this handler stopped is restarted by it. A loop the app stopped
   * deliberately — or one that has not been started yet — must not spring to
   * life because the player switched tabs and back.
   */
  /** Reset the timing window — used when the loop restarts after a suspend. */
  private clearStats(): void {
    this.frames = 0;
    this.work.length = 0;
    this.intervals.length = 0;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.rafId === null) return;
      this.stop();
      this.suspended = true;
      this.hooks.onSuspend?.();
    } else if (this.suspended) {
      this.start();
      this.hooks.onResume?.();
    }
  };
}
