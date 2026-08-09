import type { FrameStats, GameLoop } from './loop';

/**
 * The frame-budget readout, behind `?stats` (product spec §6).
 *
 * Emulation is not a handset. The spec's numbers — 60 fps sustained, sim plus
 * render inside 8 ms, a floor of 50 fps and 14 ms on a four-year-old mid-tier
 * Android — can only really be checked on the device itself, and the README's
 * whole testing story is "open it on your phone". This is what you read when
 * you do: three numbers, updated four times a second, costing one DOM write in
 * between.
 *
 * The same figures back the browser tests, through `window.__pacmanStats`.
 */

export interface StatsSummary {
  fps: number;
  /** Median and 95th-percentile milliseconds of simulation plus render. */
  workP50: number;
  workP95: number;
  /** Fraction of frames whose work stayed inside the spec's 8 ms target. */
  withinTarget: number;
  frames: number;
}

declare global {
  interface Window {
    /** Debug handle; present only when the readout is attached. */
    __pacmanStats?: () => StatsSummary;
  }
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] as number;
}

/** The spec's frame-budget target: simulation plus render inside 8 ms. */
export const BUDGET_MS = 8;

export function summarise(stats: FrameStats): StatsSummary {
  const intervals = stats.intervals;
  const median = percentile(intervals, 0.5);
  const within = stats.work.filter((ms) => ms <= BUDGET_MS).length;

  return {
    fps: median > 0 ? Math.round(1000 / median) : 0,
    workP50: percentile(stats.work, 0.5),
    workP95: percentile(stats.work, 0.95),
    withinTarget: stats.work.length > 0 ? within / stats.work.length : 0,
    frames: stats.frames,
  };
}

/** Milliseconds between readout updates. Four a second is readable and cheap. */
const REFRESH_MS = 250;

export function attachStats(loop: GameLoop, root: HTMLElement): () => void {
  const readout = document.createElement('div');
  readout.className = 'stats';
  readout.setAttribute('aria-hidden', 'true');
  root.append(readout);

  window.__pacmanStats = () => summarise(loop.stats);

  const timer = window.setInterval(() => {
    const summary = summarise(loop.stats);
    readout.textContent = `${summary.fps} fps · ${summary.workP50.toFixed(1)}/${summary.workP95.toFixed(
      1,
    )} ms · ${Math.round(summary.withinTarget * 100)}% in budget`;
  }, REFRESH_MS);

  return () => {
    window.clearInterval(timer);
    readout.remove();
    delete window.__pacmanStats;
  };
}
