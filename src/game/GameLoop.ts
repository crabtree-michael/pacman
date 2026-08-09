import { FIXED_TIMESTEP_SECONDS, MAX_FRAME_SECONDS } from './constants';

export interface GameLoopCallbacks {
  /** Advance the simulation by exactly one fixed step. */
  update(dtSeconds: number): void;
  /**
   * Draw the world. `alpha` is how far the frame sits between the last two
   * simulation steps (0..1), for interpolating positions.
   */
  render(alpha: number): void;
}

/**
 * Fixed-timestep game loop on requestAnimationFrame.
 *
 * The simulation always steps by FIXED_TIMESTEP_SECONDS so behaviour is
 * identical on a 60 Hz phone and a 120 Hz one; rendering happens once per
 * animation frame with an interpolation factor. Frame deltas are clamped so a
 * backgrounded tab does not come back to a burst of catch-up ticks.
 */
export class GameLoop {
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private accumulator = 0;

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  get isRunning(): boolean {
    return this.rafId !== null;
  }

  start(): void {
    if (this.isRunning) return;
    this.lastFrameMs = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private readonly tick = (nowMs: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    const frameSeconds = Math.min((nowMs - this.lastFrameMs) / 1000, MAX_FRAME_SECONDS);
    this.lastFrameMs = nowMs;
    this.accumulator += frameSeconds;

    while (this.accumulator >= FIXED_TIMESTEP_SECONDS) {
      this.callbacks.update(FIXED_TIMESTEP_SECONDS);
      this.accumulator -= FIXED_TIMESTEP_SECONDS;
    }

    this.callbacks.render(this.accumulator / FIXED_TIMESTEP_SECONDS);
  };
}
