import { expect, type Page } from '@playwright/test';

/**
 * Shared browser-test plumbing.
 *
 * Not a spec file — Playwright only collects `*.spec.ts` — so this can be
 * imported from every suite without being run as one.
 */

/**
 * Take the game from a fresh load to the Ready countdown.
 *
 * The boot gate holds `Boot` until the sprite atlas has decoded, and the
 * attract screen then waits for the tap that both starts the game and unlocks
 * audio (product spec §2.3, architecture §5.2 and §5.3). Every test that needs
 * a moving board goes through those two gates, exactly as a player does.
 */
export async function startPlay(page: Page): Promise<void> {
  const app = page.locator('#app');
  await expect(app, 'the boot gate never opened — did the atlas load?').toHaveAttribute(
    'data-phase',
    'Attract',
    { timeout: 15_000 },
  );

  await page.locator('#board').click();
  await expect(app).not.toHaveAttribute('data-phase', 'Attract');
}
