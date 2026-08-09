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
  /** Slack left over above and below the board inside the stage. */
  gapAbove: number;
  gapBelow: number;
  /** Slack either side of the board inside the stage. */
  gapLeft: number;
  gapRight: number;
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const app = document.getElementById('app')!;
    const board = document.getElementById('board')!.getBoundingClientRect();
    const stage = document.getElementById('stage')!.getBoundingClientRect();
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
      gapAbove: board.top - stage.top,
      gapBelow: stage.bottom - board.bottom,
      gapLeft: board.left - stage.left,
      gapRight: stage.right - board.right,
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

      // Centred in its band, both ways. The surplus the thumb band no longer
      // swallows lands here, and it has to land on both sides of the board
      // rather than piling up under it.
      expect(result.gapAbove, 'the board sits above its band').toBeGreaterThanOrEqual(-0.5);
      expect(result.gapLeft, 'the board sits left of its band').toBeGreaterThanOrEqual(-0.5);
      expect(
        Math.abs(result.gapAbove - result.gapBelow),
        'the board is not vertically centred in the stage',
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(result.gapLeft - result.gapRight),
        'the board is not horizontally centred in the stage',
      ).toBeLessThanOrEqual(1);

      expect(problems).toEqual([]);
    });
  }

  /**
   * `env(safe-area-inset-*)` is always zero in a desktop engine, notch emulation
   * included, so the only way to reproduce a handset's reserved strips is to
   * drive the custom properties the stylesheet reads them into.
   *
   * This is the case that made the layout look wrong on a real phone and right
   * everywhere else: the band maths was handed the app's `clientHeight`, which
   * counts the safe-area padding the bands never get, so every band came out
   * sized for a screen 80-odd px taller than the one it was in.
   */
  const INSET = { top: 47, bottom: 34 };

  /**
   * 360x640 is the size that has no slack to hide the bug in: its maze already
   * fills every pixel above the 180 px control-zone minimum, so 81 px of inset
   * has to come off the maze itself. A taller phone happens to have enough
   * margin around its board to swallow the error and still look fine.
   */
  for (const size of [
    { label: '360x640 small Android', width: 360, height: 640 },
    { label: '390x844 iPhone 14', width: 390, height: 844 },
  ]) {
    test(`fits inside the safe area at ${size.label}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');
      await expect.poll(async () => (await probe(page)).boardWidth).toBeGreaterThan(0);

      await page.addStyleTag({
        content: `:root { --safe-top: ${INSET.top}px; --safe-bottom: ${INSET.bottom}px; }`,
      });

      // The padding lands synchronously with the stylesheet...
      await expect
        .poll(
          async () =>
            page.evaluate(() =>
              Math.round(document.querySelector('.hud')!.getBoundingClientRect().top),
            ),
          { message: 'the inset never became padding' },
        )
        .toBe(INSET.top);

      // ...but the relayout it triggers does not. Resizing the app's content
      // box notifies the same ResizeObserver a rotation does, and observers are
      // delivered after the frame's rAF callbacks — so a probe taken in the
      // same frame as the style change reads the *old* bands. Two frames is the
      // guarantee; polling for it would not be one, since two probes can land
      // inside a single frame and agree on a layout that is about to change.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );

      const result = await probe(page);
      const zoneBottom = await page.evaluate(
        () => document.getElementById('control-zone')!.getBoundingClientRect().bottom,
      );

      // Every band stays inside the insets, which is the whole point of them.
      expect(zoneBottom, 'the control zone runs under the home indicator').toBeLessThanOrEqual(
        size.height - INSET.bottom + 0.5,
      );
      expect(result.scrolls, 'the page scrolls').toBe(false);
      // ...and the board still fits the band it was given, rather than spilling
      // over the HUD out of a stage that was sized for a taller screen.
      expect(result.gapAbove, 'the board overflows the top of the stage').toBeGreaterThanOrEqual(
        -0.5,
      );
      expect(result.gapBelow, 'the board overflows the bottom of the stage').toBeGreaterThanOrEqual(
        -0.5,
      );
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
