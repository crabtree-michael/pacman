import { Direction, type InputSnapshot } from '../sim/types';

/**
 * A short pulse on each direction change (product spec §3.2).
 *
 * This is a *consumer* of the input pipeline rather than a part of it: it
 * watches the controller's snapshot and never influences what it sees. The
 * same shape as the audio director's relationship to `state.events`, and for
 * the same reason — feedback must not be able to change behaviour.
 */

/** Long enough to feel as a tick, short enough not to read as a buzz. */
export const HAPTIC_PULSE_MS = 10;

export type Vibrate = (pattern: number) => void;

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export class Haptics {
  private enabled: boolean;
  /** The direction the last pulse was for; `null` until the first observation. */
  private lastDir: Direction | null = null;

  constructor(
    enabled: boolean,
    private readonly vibrate: Vibrate | null = isHapticsSupported()
      ? (pattern) => navigator.vibrate(pattern)
      : null,
  ) {
    this.enabled = enabled;
  }

  /** False on iOS, where `navigator.vibrate` does not exist (spec §3.2). */
  get isAvailable(): boolean {
    return this.vibrate !== null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Call once per tick with the controller's snapshot.
   *
   * The first observation only primes the comparison. Without that, mounting
   * the game would fire a pulse for a direction the player never asked for.
   */
  observe(snapshot: InputSnapshot): void {
    const previous = this.lastDir;
    this.lastDir = snapshot.dir;

    if (previous === null) return;
    if (snapshot.dir === previous || snapshot.dir === Direction.None) return;
    if (!this.enabled || !this.vibrate) return;

    try {
      this.vibrate(HAPTIC_PULSE_MS);
    } catch {
      // Some browsers throw when the page has never been interacted with.
      // A missing buzz is not worth an exception on the hot path.
    }
  }

  /** Drop the primed direction, so a reset latch does not read as a change. */
  reset(): void {
    this.lastDir = null;
  }
}
