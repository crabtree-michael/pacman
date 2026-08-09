import { expect, test, type Page } from '@playwright/test';
import { startPlay } from './harness';

/**
 * The one integration test the architecture asks for (§9, "Integration"):
 * load the page on a mobile profile, drive synthetic pointer events, and assert
 * the game responds.
 *
 * It asserts what the game actually does today — mount, fit, run the loop,
 * accept steering, and put points on the board when a drag takes Pac-Man over a
 * pellet, which is the architecture's own wording for this test.
 */

/** Pixels of one canvas layer, as a stable string. Empty until the first draw. */
async function layerFrame(page: Page, selector: string): Promise<string> {
  return page.evaluate((id) => {
    const canvas = document.querySelector<HTMLCanvasElement>(id);
    return canvas ? canvas.toDataURL() : '';
  }, selector);
}

/** The HUD's score, as a number. */
async function readScore(page: Page): Promise<number> {
  return Number.parseInt((await page.locator('[data-hud="score"]').textContent()) ?? '0', 10);
}

/** The score once it stops climbing — Pac-Man has run out of corridor. */
async function settledScore(page: Page): Promise<number> {
  let last = await readScore(page);
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(150);
    const next = await readScore(page);
    if (next === last && next > 0) return next;
    last = next;
  }
  throw new Error('the score never settled');
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
    await startPlay(page);

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
    await startPlay(page);

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
    await startPlay(page);

    await expect(page.locator('[data-hud="score"]')).toHaveText('00');
    await expect(page.locator('[data-hud="lives"] .status__life')).toHaveCount(3);
    // Level 1, so one fruit marker: the cherry (product spec §2.1, §4.4).
    await expect(page.locator('[data-hud="levels"] .status__fruit')).toHaveCount(1);
  });

  test('runs the loop: the entity layer is still during Ready and moves in Playing', async ({
    page,
  }) => {
    await page.goto('/');
    await startPlay(page);

    // Nothing moves during the countdown, so a frame that holds still proves
    // the renderer is drawing from state rather than repainting noise.
    const ready = await settledFrame(page);
    await page.waitForTimeout(400);
    expect(await entityFrame(page)).toBe(ready);

    // Past the countdown Pac-Man walks off on his own, so the layer must change.
    //
    // Sampled continuously across the end of the countdown rather than at two
    // chosen moments: with nobody steering and no ghosts to dodge, he eats his
    // way to the wall at the end of his corridor and stops there for good about
    // a second into play. Any pair of samples taken after that compares two
    // identical parked frames, whatever the wait before them was.
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
    await startPlay(page);
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

  test('steers Pac-Man with a synthetic drag, and the score follows', async ({ page }) => {
    await page.goto('/');
    await startPlay(page);
    await page.waitForTimeout(READY_MS + 200); // Let the countdown finish.

    // Pac-Man walks off to the left on his own and eats his way to the wall at
    // the end of that corridor. Waiting for the score to stop climbing is what
    // makes the rest of this test about the drag rather than about the walk he
    // was already taking.
    const parked = await settledScore(page);
    expect(parked).toBeGreaterThan(0);

    const zone = page.locator('#control-zone');
    const box = (await zone.boundingBox())!;
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;

    // He is parked against a wall facing left, so only a reversal can move him
    // — and the pellets he already ate are behind him, so the score can only
    // move if the drag really reached the simulation. That makes this the
    // architecture's "assert the score changes" end to end: pointer → intent →
    // simulation → HUD.
    const before = await entityFrame(page);

    await page.mouse.move(centreX, centreY);
    await page.mouse.down();
    await page.mouse.move(centreX + 70, centreY, { steps: 8 });
    await page.waitForTimeout(400);
    await page.mouse.up();

    expect(await entityFrame(page)).not.toBe(before);
    await expect
      .poll(() => readScore(page), {
        message: 'the drag should have taken Pac-Man over fresh pellets',
        timeout: 5000,
        intervals: [100],
      })
      .toBeGreaterThan(parked);
  });

  /**
   * The phase machine, seen from outside: the only proof that the pause path
   * runs end to end — button, phase, overlay, and a loop that keeps painting a
   * game that is no longer advancing.
   */
  test('pauses on the HUD button and resumes on a tap', async ({ page }) => {
    await page.goto('/');
    await startPlay(page);
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

  test('re-lays out in landscape and keeps the lives visible', async ({ page }, testInfo) => {
    await page.goto('/');
    await startPlay(page);
    const viewport = testInfo.project.use.viewport!;
    // Rotate: swap the two dimensions and let the ResizeObserver settle.
    await page.setViewportSize({ width: viewport.height, height: viewport.width });

    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-orientation', 'landscape');

    // Spec §2.2 puts SCORE / LIVES / pause in the right-hand column. Lives were
    // previously dropped altogether in landscape; they are not optional chrome.
    await expect(page.locator('[data-hud="lives"]')).toBeVisible();
    await expect(page.locator('[data-hud="lives"] .status__life')).toHaveCount(3);

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
    await startPlay(page);
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
    await startPlay(page);
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

  /**
   * The autoplay rule, which is an iOS Safari problem before it is anyone
   * else's: an `AudioContext` created outside a user gesture stays suspended
   * for the rest of the session, and the game would be silent with no error to
   * show for it (architecture §5.2, §10). The attract screen's tap is the
   * gesture, so this is the test that it is being used as one.
   */
  test('creates the audio context on the first tap, and not before', async ({ page }) => {
    await page.addInitScript(() => {
      const probe = { constructed: 0, resumed: 0, state: 'none' };
      (window as unknown as { __audio: typeof probe }).__audio = probe;

      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        constructor() {
          super();
          probe.constructed++;
          const track = (): void => {
            probe.state = this.state;
          };
          track();
          this.addEventListener('statechange', track);
        }

        override resume(): Promise<void> {
          probe.resumed++;
          return super.resume().then(() => {
            probe.state = this.state;
          });
        }
      };
    });

    const probe = (): Promise<{ constructed: number; resumed: number; state: string }> =>
      page.evaluate(
        () =>
          (window as unknown as { __audio: { constructed: number; resumed: number; state: string } })
            .__audio,
      );

    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'Attract');
    expect(await probe(), 'audio must not be started before a gesture').toEqual({
      constructed: 0,
      resumed: 0,
      state: 'none',
    });

    await page.locator('#board').click();

    // Chromium hands back a context that is already running when it is created
    // inside a user activation; WebKit hands back a suspended one and needs the
    // `resume()` the engine calls in the same gesture. Both end up running, and
    // it is the ending state that decides whether the game has sound.
    await expect.poll(async () => (await probe()).state).toBe('running');
    expect((await probe()).constructed, 'one context, created on the tap').toBe(1);
  });

  test('loads without console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(String(error)));

    await page.goto('/');
    await startPlay(page);
    await page.waitForTimeout(READY_MS + 500);

    expect(problems).toEqual([]);
  });
});
