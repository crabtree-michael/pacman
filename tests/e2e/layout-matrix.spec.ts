import { expect, test, type Page } from '@playwright/test';

/**
 * The responsive-sizing sweep the architecture calls the skeleton's riskiest
 * cross-cutting concern (§12, step 1): every supported screen size, both
 * orientations, both engines.
 *
 * `tests/app/layout.test.ts` snapshots the band *maths* headlessly. This spec
 * checks what that maths actually produces in a browser — that the board is
 * painted, nothing overflows the viewport, and the document never scrolls.
 * Those are the failures a numeric snapshot cannot see.
 */

/** Spans the product spec's stated support range: 320x568 to 1024x1366. */
const SIZES = [
  { label: '320x568 smallest supported', width: 320, height: 568 },
  { label: '360x640 small Android', width: 360, height: 640 },
  { label: '390x844 iPhone 14', width: 390, height: 844 },
  { label: '430x932 Pro Max', width: 430, height: 932 },
  { label: '768x1024 tablet', width: 768, height: 1024 },
  { label: '1024x1366 large tablet', width: 1024, height: 1366 },
  { label: '568x320 landscape small', width: 568, height: 320 },
  { label: '844x390 landscape phone', width: 844, height: 390 },
  { label: '1024x768 landscape tablet', width: 1024, height: 768 },
] as const;

interface Probe {
  orientation: string;
  tooSmall: string;
  boardWidth: number;
  boardHeight: number;
  /** Fraction of the maze layer's backing store with a non-zero alpha. */
  painted: number;
  overflowsRight: boolean;
  overflowsBottom: boolean;
  scrolls: boolean;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const app = document.getElementById('app')!;
    const board = document.getElementById('board')!.getBoundingClientRect();
    const zone = document.getElementById('control-zone')!.getBoundingClientRect();
    const maze = document.getElementById('layer-maze') as HTMLCanvasElement;

    const pixels = maze
      .getContext('2d')!
      .getImageData(0, 0, maze.width, maze.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i]! > 0) opaque++;
    }

    return {
      orientation: app.dataset['orientation'] ?? '',
      tooSmall: app.dataset['tooSmall'] ?? '',
      boardWidth: board.width,
      boardHeight: board.height,
      painted: opaque / (maze.width * maze.height),
      // Half a pixel of slack absorbs sub-pixel rounding in the band maths.
      overflowsRight: board.right > window.innerWidth + 0.5,
      overflowsBottom: zone.bottom > window.innerHeight + 0.5,
      scrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  });
}

test.describe('layout matrix', () => {
  for (const size of SIZES) {
    test(`fits and paints at ${size.label}`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
      page.on('pageerror', (e) => problems.push(String(e)));

      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');

      // The board is sized by the ResizeObserver, so poll rather than sleep.
      await expect
        .poll(async () => (await probe(page)).boardWidth, {
          message: 'the board never got a width — did the layout run?',
        })
        .toBeGreaterThan(0);

      const result = await probe(page);

      expect(result.tooSmall, 'every size here is supported').toBe('false');
      expect(result.orientation).toBe(
        size.width > size.height ? 'landscape' : 'portrait',
      );

      // The maze is drawn once per level; a blank layer means the one-shot
      // draw raced the resize and never re-ran.
      expect(result.painted, 'the maze layer should have been drawn').toBeGreaterThan(0.05);

      expect(result.boardWidth).toBeLessThanOrEqual(size.width);
      expect(result.boardHeight).toBeLessThanOrEqual(size.height);
      expect(result.overflowsRight, 'the board runs off the right edge').toBe(false);
      expect(result.overflowsBottom, 'the control zone runs off the bottom').toBe(false);
      // Spec §2.4: the document never scrolls.
      expect(result.scrolls, 'the page scrolls').toBe(false);

      expect(problems).toEqual([]);
    });
  }

  test('shows the too-small notice below the supported width', async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 600 });
    await page.goto('/');

    await expect(page.locator('#app')).toHaveAttribute('data-too-small', 'true');
    await expect(page.locator('.too-small')).toBeVisible();
    // The board is hidden rather than rendered at an unplayable size.
    await expect(page.locator('#board')).toBeHidden();
  });
});
