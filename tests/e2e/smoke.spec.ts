import { expect, test, type Page } from '@playwright/test';

/**
 * The one integration test the architecture asks for (§9, "Integration"):
 * load the page on a mobile profile, drive synthetic pointer events, and assert
 * the game responds.
 *
 * It asserts what the skeleton actually does today — mount, fit, run the loop,
 * accept steering. The architecture's eventual "assert the score changes" needs
 * pellet collection, which is `TODO(mechanics)`; the hook for it is at the end
 * of this file.
 */

/** Pixels of one canvas layer, as a stable string. Empty until the first draw. */
async function layerFrame(page: Page, selector: string): Promise<string> {
  return page.evaluate((id) => {
    const canvas = document.querySelector<HTMLCanvasElement>(id);
    return canvas ? canvas.toDataURL() : '';
  }, selector);
}

async function entityFrame(page: Page): Promise<string> {
  return layerFrame(page, '#layer-entities');
}

/**
 * The frame, once the first paint has settled.
 *
 * The very first draw happens before the ResizeObserver has fitted the layers,
 * so a sample taken immediately after `goto` catches a half-built frame. Poll
 * until two consecutive reads agree rather than sleeping a guessed interval.
 */
async function settledFrame(page: Page): Promise<string> {
  let last = await entityFrame(page);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(100);
    const next = await entityFrame(page);
    if (next === last && next !== '') return next;
    last = next;
  }
  throw new Error('the entity layer never settled — is the render loop running?');
}

/** Ready lasts 3 s before play begins; wait past it with room to spare. */
const READY_MS = 3000;

test.describe('skeleton smoke', () => {
  test('mounts every layer and fits them to the screen', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Pac-Man');

    for (const id of ['#layer-maze', '#layer-entities', '#layer-overlay']) {
      const size = await page.locator(id).evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        return { width: canvas.width, height: canvas.height };
      });
      // A zero-sized backing store means the viewport maths never ran.
      expect(size.width, `${id} backing store width`).toBeGreaterThan(0);
      expect(size.height, `${id} backing store height`).toBeGreaterThan(0);
    }
  });

  test('lays the bands out in portrait and stays inside the screen', async ({ page }, testInfo) => {
    await page.goto('/');

    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-orientation', 'portrait');
    await expect(app).toHaveAttribute('data-too-small', 'false');

    const vars = await app.evaluate((node) => {
      const style = getComputedStyle(node);
      const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name));
      return {
        mazeWidth: read('--maze-width'),
        mazeHeight: read('--maze-height'),
        controlZone: read('--control-zone'),
      };
    });

    const viewport = testInfo.project.use.viewport!;
    expect(vars.mazeWidth).toBeGreaterThan(0);
    expect(vars.mazeWidth).toBeLessThanOrEqual(viewport.width);
    expect(vars.mazeHeight).toBeLessThanOrEqual(viewport.height);
    // The thumb's band never gets squeezed below the spec's minimum.
    expect(vars.controlZone).toBeGreaterThanOrEqual(180);
  });

  test('shows the HUD in its starting state', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[data-hud="score"]')).toHaveText('00');
    await expect(page.locator('[data-hud="lives"]')).toHaveText('●●●');
  });

  test('runs the loop: the entity layer is still during Ready and moves in Playing', async ({
    page,
  }) => {
    await page.goto('/');

    // Nothing moves during the countdown, so a frame that holds still proves
    // the renderer is drawing from state rather than repainting noise.
    const ready = await settledFrame(page);
    await page.waitForTimeout(400);
    expect(await entityFrame(page)).toBe(ready);

    // Past the countdown Pac-Man walks off on his own, so the layer must change.
    //
    // Sampled continuously across the end of the countdown rather than at two
    // chosen moments: with no pellets to eat and no ghosts to dodge, he reaches
    // the wall at the end of his corridor and stops for good less than a second
    // into play. Any pair of samples taken after that compares two identical
    // parked frames, whatever the wait before them was.
    // TODO(mechanics): once he has somewhere to be, this can go back to a sleep
    // and a single comparison.
    const frames = new Set<string>();
    const deadline = Date.now() + READY_MS + 1000;
    while (Date.now() < deadline) {
      frames.add(await entityFrame(page));
      await page.waitForTimeout(80);
    }

    frames.delete(ready);
    expect(frames.size, 'distinct frames drawn once play began').toBeGreaterThanOrEqual(3);
  });

  test('floats the joystick to the thumb and follows a drag', async ({ page }) => {
    await page.goto('/');
    // The knob is moved by the render loop, not by the pointer handler, so the
    // layers must be up before any of this means anything.
    await settledFrame(page);

    const zone = page.locator('#control-zone');
    const base = page.locator('[data-joystick-base]');
    const knob = page.locator('[data-joystick-knob]');

    /** The transform the knob wears when it is sitting at the centre. */
    const CENTRED = 'translate(-50%, -50%)';
    const transform = (): Promise<string> =>
      knob.evaluate((node) => (node as HTMLElement).style.transform);

    const box = (await zone.boundingBox())!;
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;

    await expect(base).not.toHaveClass(/joystick__base--active/);

    await page.mouse.move(centreX, centreY);
    await page.mouse.down();
    await expect(base).toHaveClass(/joystick__base--active/);

    // Drag well past the 12px dead zone. The knob catches up on the next
    // rendered frame, so poll for it rather than reading once.
    await page.mouse.move(centreX + 60, centreY, { steps: 8 });
    await expect
      .poll(transform, { message: 'the knob should have left the centre' })
      .not.toBe(CENTRED);

    await page.mouse.up();
    await expect(base).not.toHaveClass(/joystick__base--active/);
    // Releasing re-centres the knob but keeps the latched direction (spec §3.2).
    await expect.poll(transform).toBe(CENTRED);
  });

  test('steers Pac-Man with a synthetic drag', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(READY_MS + 200); // Let the countdown finish.

    const zone = page.locator('#control-zone');
    const box = (await zone.boundingBox())!;
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;

    // Pac-Man spawns walking left down a corridor with walls above and below,
    // so a downward flick must not move him — but a rightward one reverses him
    // on the spot. Comparing the two frames is the cheapest proof that the
    // pointer → intent → simulation path is connected end to end.
    const before = await entityFrame(page);

    await page.mouse.move(centreX, centreY);
    await page.mouse.down();
    await page.mouse.move(centreX + 70, centreY, { steps: 8 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    expect(await entityFrame(page)).not.toBe(before);

    // TODO(mechanics): once pellet collection lands, tighten this to the
    // architecture's original wording — assert the score changes.
  });

  /**
   * The phase machine, seen from outside: the only proof that the pause path
   * runs end to end — button, phase, overlay, and a loop that keeps painting a
   * game that is no longer advancing.
   */
  test('pauses on the HUD button and resumes on a tap', async ({ page }) => {
    await page.goto('/');
    await settledFrame(page);

    // Anchored on the READY! card clearing, which happens exactly when play
    // begins — and, unlike the entity layer, changes once and then holds. The
    // pause has to land while Pac-Man is still walking to prove anything, and
    // he only walks for the second or so it takes him to reach the wall.
    const readyOverlay = await layerFrame(page, '#layer-overlay');
    await expect
      .poll(() => layerFrame(page, '#layer-overlay'), {
        message: 'the READY! card should have cleared',
        timeout: READY_MS * 2,
        intervals: [100],
      })
      .not.toBe(readyOverlay);

    // Nothing is on the overlay during play; the pause card is a real change.
    const playingOverlay = await layerFrame(page, '#layer-overlay');

    await page.locator('[data-action="pause"]').click();
    await expect
      .poll(() => layerFrame(page, '#layer-overlay'), {
        message: 'the pause card should have been drawn',
        intervals: [100],
      })
      .not.toBe(playingOverlay);

    // A paused game does not tick, so the entity layer stops dead — while the
    // loop itself keeps running, which is what draws the card. The wait is
    // wall-clock time the simulation never sees, so Pac-Man has just as much
    // walking left when it ends.
    const frozen = await entityFrame(page);
    await page.waitForTimeout(400);
    expect(await entityFrame(page)).toBe(frozen);

    // Tapping the board resumes it (product spec §2.3).
    await page.locator('#board').click();
    await expect
      .poll(entityFrame.bind(null, page), {
        message: 'the game should be moving again',
        intervals: [100],
      })
      .not.toBe(frozen);
    expect(await layerFrame(page, '#layer-overlay')).toBe(playingOverlay);
  });

  test('loads without console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(String(error)));

    await page.goto('/');
    await page.waitForTimeout(READY_MS + 500);

    expect(problems).toEqual([]);
  });
});
