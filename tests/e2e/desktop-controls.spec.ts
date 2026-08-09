import { expect, test, type Page } from '@playwright/test';
import { startPlay } from './harness';

/**
 * Desktop steering in a real browser (product spec §3.3): a cursor that steers
 * by hovering the stick, and arrow keys that lean the stick as they go.
 *
 * The rest of the browser suite runs on the two handset profiles, where there
 * is no cursor to rest anywhere and `(hover: hover)` is false — which is
 * precisely why none of this can be checked there. This file is the same app on
 * a desktop-shaped context: no touch, no mobile emulation, a window big enough
 * to be a laptop. It is also the only place the hover path is exercised at all,
 * so it doubles as the proof that a mouse cannot steer a phone.
 */
test.use({
  viewport: { width: 1280, height: 800 },
  isMobile: false,
  hasTouch: false,
});

/** The transform the knob wears when it is sitting at the centre. */
const CENTRED = 'translate(-50%, -50%)';

const knobTransform = (page: Page): Promise<string> =>
  page.locator('[data-joystick-knob]').evaluate((node) => (node as HTMLElement).style.transform);

/** Centre of the ring, in client coordinates. */
async function ringCentre(page: Page): Promise<{ x: number; y: number; radius: number }> {
  const box = (await page.locator('[data-joystick-base]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, radius: box.width / 2 };
}

/**
 * Load, start, and get to a board that is actually simulating.
 *
 * `Ready` clears the input latch on its way in, so a direction requested during
 * the countdown is a direction thrown away — and the chevron these tests read is
 * that latch.
 */
async function play(page: Page): Promise<void> {
  await page.goto('/');
  await startPlay(page);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'Playing', { timeout: 15_000 });
}

test.describe('a cursor steers the stick by being on it', () => {
  test('reads the direction from where the cursor sits', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');
    const ring = await ringCentre(page);

    await expect(base).not.toHaveClass(/joystick__base--hover/);

    // No button, at any point in this test. Above centre is up.
    await page.mouse.move(ring.x, ring.y - ring.radius / 2);
    await expect(base).toHaveClass(/joystick__base--hover/);
    await expect(base).toHaveClass(/joystick__base--active/);
    await expect(base).toHaveAttribute('data-direction', 'up');

    // Round the gate to the other side, still without pressing anything.
    await page.mouse.move(ring.x - ring.radius / 2, ring.y);
    await expect(base).toHaveAttribute('data-direction', 'left');
  });

  test('sends the knob home when the cursor leaves, and keeps the latch', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');
    const ring = await ringCentre(page);

    await page.mouse.move(ring.x + ring.radius / 2, ring.y);
    await expect(base).toHaveAttribute('data-direction', 'right');
    await expect.poll(() => knobTransform(page)).not.toBe(CENTRED);

    // Off to the middle of the maze.
    const board = (await page.locator('#board').boundingBox())!;
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);

    await expect(base).not.toHaveClass(/joystick__base--hover/);
    await expect(base).not.toHaveClass(/joystick__base--active/);
    await expect.poll(() => knobTransform(page)).toBe(CENTRED);
    // Letting go of the stick does not stop Pac-Man (product spec §3.2).
    await expect(base).toHaveAttribute('data-direction', 'right');
  });

  test('ignores a cursor crossing the band well away from the stick', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');
    const zone = (await page.locator('#control-zone').boundingBox())!;
    const ring = await ringCentre(page);

    // Inside the control zone, but the far end of it from the ring.
    const far = ring.y > zone.y + zone.height / 2 ? zone.y + 4 : zone.y + zone.height - 4;
    await page.mouse.move(ring.x, far);

    await expect(base).not.toHaveClass(/joystick__base--hover/);
    await expect(base).toHaveAttribute('data-direction', 'none');
  });
});

test.describe('the keyboard leans the stick it shares (product spec §3.3)', () => {
  test('throws the knob while a direction key is held, and springs it back', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');

    await page.keyboard.down('ArrowUp');
    await expect(base).toHaveAttribute('data-direction', 'up');
    await expect(base).toHaveClass(/joystick__base--active/);
    await expect.poll(() => knobTransform(page)).not.toBe(CENTRED);

    await page.keyboard.up('ArrowUp');
    await expect.poll(() => knobTransform(page)).toBe(CENTRED);
    await expect(base).not.toHaveClass(/joystick__base--active/);
    // The knob going slack is a statement about the hand, not about Pac-Man.
    await expect(base).toHaveAttribute('data-direction', 'up');
  });

  test('follows WASD the same way', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');

    await page.keyboard.down('KeyA');
    await expect(base).toHaveAttribute('data-direction', 'left');
    await page.keyboard.up('KeyA');
  });

  test('hands the stick back to the cursor', async ({ page }) => {
    await play(page);
    const base = page.locator('[data-joystick-base]');
    const ring = await ringCentre(page);

    await page.keyboard.down('ArrowDown');
    await expect(base).toHaveAttribute('data-direction', 'down');

    // A cursor on the stick outranks the key: it is the finer control of the
    // two, and it is the one the player has just moved.
    await page.mouse.move(ring.x + ring.radius / 2, ring.y);
    await expect(base).toHaveAttribute('data-direction', 'right');
    await page.keyboard.up('ArrowDown');
  });
});
