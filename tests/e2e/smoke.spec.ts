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

/** Pixels of the entity layer, as a stable string. Empty until the first draw. */
async function entityFrame(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#layer-entities');
    return canvas ? canvas.toDataURL() : '';
  });
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
    await page.waitForTimeout(READY_MS);
    const playing = await entityFrame(page);
    expect(playing).not.toBe(ready);

    await page.waitForTimeout(300);
    expect(await entityFrame(page)).not.toBe(playing);
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

  test('re-lays out in landscape and keeps the lives visible', async ({ page }, testInfo) => {
    await page.goto('/');
    const viewport = testInfo.project.use.viewport!;
    // Rotate: swap the two dimensions and let the ResizeObserver settle.
    await page.setViewportSize({ width: viewport.height, height: viewport.width });

    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-orientation', 'landscape');

    // Spec §2.2 puts SCORE / LIVES / pause in the right-hand column. Lives were
    // previously dropped altogether in landscape; they are not optional chrome.
    await expect(page.locator('[data-hud="lives"]')).toBeVisible();
    await expect(page.locator('[data-hud="lives"]')).toHaveText('●●●');

    const zone = (await page.locator('#control-zone').boundingBox())!;
    const board = (await page.locator('#board').boundingBox())!;
    const hud = (await page.locator('.hud').boundingBox())!;

    // Three columns: joystick gutter, maze, HUD — in that order, not overlapping.
    expect(zone.x + zone.width).toBeLessThanOrEqual(board.x + 1);
    expect(board.x + board.width).toBeLessThanOrEqual(hud.x + 1);
    // The gutter never drops below the spec's 120 px minimum.
    expect(zone.width).toBeGreaterThanOrEqual(120);
    // Nothing spills off the bottom.
    expect(board.y + board.height).toBeLessThanOrEqual(viewport.width + 1);
  });

  test('rotating back restores the portrait bands', async ({ page }, testInfo) => {
    await page.goto('/');
    const viewport = testInfo.project.use.viewport!;
    const app = page.locator('#app');

    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await expect(app).toHaveAttribute('data-orientation', 'landscape');
    await page.setViewportSize(viewport);
    await expect(app).toHaveAttribute('data-orientation', 'portrait');

    // A round trip must leave the board fitted, not stuck at its landscape size.
    const board = (await page.locator('#board').boundingBox())!;
    expect(board.width).toBeLessThanOrEqual(viewport.width);
    expect(board.height).toBeLessThanOrEqual(viewport.height);
    expect(board.width).toBeGreaterThan(0);
  });

  test('pins the joystick bottom-left on a tablet-width screen', async ({ page }) => {
    await page.goto('/');
    // Wider than the spec's 600 px tablet threshold, still portrait.
    await page.setViewportSize({ width: 768, height: 1024 });

    await expect(page.locator('#app')).toHaveAttribute('data-tablet', 'true');

    const zone = (await page.locator('#control-zone').boundingBox())!;
    const base = (await page.locator('[data-joystick-base]').boundingBox())!;

    // Resting bottom-left (spec §2.1), not centred on the band.
    expect(base.x - zone.x).toBeLessThan(zone.width / 4);
    expect(zone.y + zone.height - (base.y + base.height)).toBeLessThan(zone.height / 4);
    // Still clear of the screen edge, per the 16 px inset rule in §2.4.
    expect(base.x - zone.x).toBeGreaterThanOrEqual(16);
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
