import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { StatsSummary } from '../../src/app/stats';
import { startPlay } from './harness';

/**
 * The product spec's §6 numbers, measured in a browser.
 *
 * Two things are checked, and they are different questions. **Frame budget** is
 * how long the game spends per frame doing its own work — simulation plus
 * render — and it is the number that decides whether a slower device can keep
 * up. **Frame pace** is what the display actually delivered. A test machine
 * under load can miss frames without the game having done anything wrong, so
 * the budget is asserted and the pace only reported.
 *
 * Emulation is not a handset. What this catches is a regression — an atlas
 * decoded per frame, a maze redrawn every tick, a per-frame allocation that
 * turns into a GC pause. The absolute numbers on a four-year-old Android come
 * from `?stats` on the device itself; see the README.
 */

/** Spec §6: sim + render inside 8 ms, with 14 ms as the acceptable floor. */
const BUDGET_MS = 8;
const BUDGET_FLOOR_MS = 14;

/** Spec §6: touch to visible change, one frame typically and two at p95. */
const LATENCY_FRAMES_P95 = 2;
const FRAME_MS = 1000 / 60;

/** Fill rate scales with the board, so the ends of the supported range matter. */
const SIZES = [
  { label: '320x568 smallest supported', width: 320, height: 568 },
  { label: '390x844 iPhone 14', width: 390, height: 844 },
  { label: '1024x1366 large tablet', width: 1024, height: 1366 },
] as const;

async function measure(page: Page, forMs: number): Promise<StatsSummary> {
  await page.waitForTimeout(forMs);
  const summary = await page.evaluate(() => window.__pacmanStats?.());
  if (!summary) throw new Error('the ?stats readout was not attached');
  return summary;
}

/** Put the measurement in the report, so a run is evidence and not just a pass. */
function report(testInfo: TestInfo, label: string, summary: StatsSummary): void {
  testInfo.annotations.push({
    type: 'measured',
    description:
      `${label}: ${summary.fps} fps, work p50 ${summary.workP50.toFixed(2)} ms, ` +
      `p95 ${summary.workP95.toFixed(2)} ms, ` +
      `${(summary.withinTarget * 100).toFixed(1)}% inside ${BUDGET_MS} ms ` +
      `(${summary.frames} frames)`,
  });
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

test.describe('performance', () => {
  for (const size of SIZES) {
    test(`keeps a frame inside the budget at ${size.label}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/?stats');
      await startPlay(page);

      // Past the countdown, so what is measured is a moving board: four ghosts
      // targeting, 244 collectibles drawn, and sprites composited every frame.
      await page.waitForTimeout(3200);
      const summary = await measure(page, 4000);
      report(testInfo, size.label, summary);

      // Enough frames for a percentile to mean something. Deliberately not a
      // frame-rate assertion in disguise: headless WebKit rasterises in
      // software, so the largest board at this profile's 3x density is a
      // 3072x4098 surface per layer and it paints at a fraction of 60 Hz. That
      // combination is not a device — the iPad that is 1024x1366 is a 2x screen
      // with a GPU. What the game is answerable for is the work below.
      expect(summary.frames, 'frames measured').toBeGreaterThan(50);
      expect(summary.workP50, 'median frame work, ms').toBeLessThanOrEqual(BUDGET_MS);
      // The floor rather than the target at p95: one frame in twenty on a
      // shared CI machine lands on someone else's scheduling.
      expect(summary.workP95, '95th-percentile frame work, ms').toBeLessThanOrEqual(
        BUDGET_FLOOR_MS,
      );
      expect(summary.withinTarget, 'fraction of frames inside the target').toBeGreaterThan(0.9);
    });
  }

  test('holds its pace through the moments players notice', async ({ page }, testInfo) => {
    await page.goto('/?stats');
    await startPlay(page);
    await page.waitForTimeout(3200);

    // The level-complete flash redraws the maze layer several times a second,
    // and the death animation swaps a sprite every 90 ms. Spec §6 singles both
    // out: they are where a dropped frame is most visible. Steering up into the
    // ghosts is the cheap way to reach one of them from a test.
    const zone = (await page.locator('#control-zone').boundingBox())!;
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2);
    await page.mouse.down();
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2 - 70, { steps: 6 });

    const summary = await measure(page, 6000);
    await page.mouse.up();
    report(testInfo, 'through a death and respawn', summary);

    expect(summary.workP95, '95th-percentile frame work, ms').toBeLessThanOrEqual(
      BUDGET_FLOOR_MS,
    );
  });

  test('shows a touch on screen within two frames', async ({ page }, testInfo) => {
    await page.goto('/?stats');
    await startPlay(page);

    // Timed inside the page, because the round trip through the test runner is
    // itself tens of milliseconds — far more than the thing being measured.
    // The knob is the first visible response to a thumb, and it is written by
    // the render loop, so the gap between the event and the frame that shows it
    // is exactly the spec's "touch to visible change".
    await page.evaluate(() => {
      const samples: number[] = [];
      (window as unknown as { __latency: number[] }).__latency = samples;

      const knob = document.querySelector<HTMLElement>('[data-joystick-knob]')!;
      let pending: number | null = null;
      let last = knob.style.transform;

      addEventListener(
        'pointermove',
        () => {
          pending ??= performance.now();
        },
        true,
      );

      const watch = (): void => {
        const now = knob.style.transform;
        if (pending !== null && now !== last) {
          samples.push(performance.now() - pending);
          pending = null;
        }
        last = now;
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });

    const zone = (await page.locator('#control-zone').boundingBox())!;
    const centreX = zone.x + zone.width / 2;
    const centreY = zone.y + zone.height / 2;

    await page.mouse.move(centreX, centreY);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) {
      // Alternate sides so every move is a real change of position, and leave
      // a frame between them so each one is measured on its own.
      await page.mouse.move(centreX + (i % 2 === 0 ? 55 : -55), centreY);
      await page.waitForTimeout(60);
    }
    await page.mouse.up();

    const samples = await page.evaluate(
      () => (window as unknown as { __latency: number[] }).__latency,
    );

    // Measured against the pace the browser actually kept, not against an
    // assumed 60 Hz. The spec's budget is "two frames"; the 33 ms beside it is
    // that budget at 60 Hz, and a headless WebKit that paints at 38 fps has a
    // longer frame without the game having got any slower.
    const summary = await measure(page, 0);
    const frameMs = summary.fps > 0 ? 1000 / summary.fps : FRAME_MS;
    const p95 = percentile(samples, 0.95);

    testInfo.annotations.push({
      type: 'measured',
      description:
        `touch to paint: p50 ${percentile(samples, 0.5).toFixed(1)} ms, ` +
        `p95 ${p95.toFixed(1)} ms over ${samples.length} samples ` +
        `(${(p95 / frameMs).toFixed(2)} frames at the ${summary.fps} fps measured)`,
    });

    expect(samples.length, 'latency samples').toBeGreaterThanOrEqual(8);
    expect(p95 / frameMs, '95th-percentile touch-to-paint, frames').toBeLessThanOrEqual(
      LATENCY_FRAMES_P95,
    );
  });
});
