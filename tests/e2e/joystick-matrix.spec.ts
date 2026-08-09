import { expect, test, type Page } from '@playwright/test';

/**
 * The joystick half of the responsiveness sweep (product spec §3, §5).
 *
 * `layout-matrix.spec.ts` proves the *bands* fit at every supported size. This
 * one proves the control inside the bottom band is actually usable there: that
 * the ring never clips its zone however the band is shaped, that the stick
 * steers from any corner of it, and that the feedback the spec asks for —
 * chevron, buffered tint, the animated return — happens in a real browser.
 *
 * The spec's success criterion is "no clipping or unreachable controls" across
 * 320x568 to 1024x1366, and unreachable is the harder half: a ring that fits
 * but only responds near the middle of the band fails the player just as badly.
 */

/** The same span `layout-matrix.spec.ts` sweeps, so the two stay comparable. */
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

/** Sub-pixel slack, for rects that are the product of fractional band maths. */
const SLACK = 1;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function rectOf(page: Page, selector: string): Promise<Rect> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box — is it displayed?`);
  return box;
}

/**
 * Wait for the layout to settle, rather than sleeping a guessed interval.
 *
 * "The board has a width" is not enough. The ResizeObserver can run more than
 * once while the dynamic viewport resolves during load, and each run re-places
 * the ring — so a measurement taken on the first pass reads a position the
 * stick is about to leave. Poll until two consecutive reads of the ring's own
 * placement agree, which is the same settling idiom `smoke.spec.ts` uses for
 * the entity layer.
 */
async function settled(page: Page): Promise<void> {
  const placement = (): Promise<string> =>
    page.evaluate(() => {
      const board = document.getElementById('board')!.getBoundingClientRect();
      const base = document.querySelector<HTMLElement>('[data-joystick-base]')!;
      const rect = base.getBoundingClientRect();
      return board.width > 0
        ? `${board.width}|${rect.x}|${rect.y}|${rect.width}`
        : 'unlaid';
    });

  let last = await placement();
  await expect
    .poll(
      async () => {
        const next = await placement();
        const stable = next === last && next !== 'unlaid';
        last = next;
        return stable;
      },
      { message: 'the layout never stopped moving — did the resize loop settle?' },
    )
    .toBe(true);
}

/**
 * Wait until Pac-Man has walked the spawn corridor out and stopped, alive.
 *
 * Left unsteered he heads left from (13, 23), eats seven pellets and parks
 * against the wall at (6, 23). That parked state is what makes the turn-buffer
 * assertions below deterministic: *left* is the one direction that can never be
 * honoured from it, so a request for it sits in the buffer for the spec's full
 * 400 ms and then expires. Anywhere mid-corridor the maze offers a turn every
 * three tiles, and whether a request is still buffered a frame later comes down
 * to timing.
 *
 * Waiting a fixed number of milliseconds does not get there reliably. The
 * simulation advances in fixed ticks driven by `requestAnimationFrame`, and a
 * frame the engine never delivers is time the sim skips rather than makes up
 * (the `MAX_FRAME_MS` clamp) — so sim time runs behind wall-clock time by
 * however much the engine stalls, and WebKit stalls more than Chromium.
 *
 * The score answers the question directly: it climbs while he is eating his way
 * along the corridor and stops when he runs out of it. It used to be the entity
 * layer holding still that said so, which stopped working the day the ghosts
 * started moving — that canvas now changes on every frame for ever. Lives are
 * read alongside it because a ghost eventually finds him, and a game that has
 * moved on to the death freeze is also perfectly still.
 */
async function waitUntilParked(page: Page): Promise<void> {
  const reading = (): Promise<string> =>
    page.evaluate(() => {
      const score = document.querySelector('[data-hud="score"]')?.textContent ?? '';
      const lives = document.querySelectorAll('[data-hud="lives"] .status__life').length;
      return `${score}|${lives}`;
    });

  let last = await reading();
  let moved = false;
  let stable = 0;

  await expect
    .poll(
      async () => {
        const next = await reading();
        if (next !== last) {
          moved = true;
          stable = 0;
        } else {
          stable++;
        }
        last = next;
        // The score has to have climbed before it stopping means anything:
        // it is also perfectly stable through the three-second countdown.
        return moved && stable >= 2 && last.endsWith('|3');
      },
      {
        message: 'Pac-Man never ate his way along the corridor and stopped, alive',
        intervals: [100],
        timeout: 20_000,
      },
    )
    .toBe(true);
}

/** Centre of the joystick ring, in zone-local px. */
async function baseCentre(page: Page): Promise<{ x: number; y: number }> {
  const zone = await rectOf(page, '#control-zone');
  const base = await rectOf(page, '[data-joystick-base]');
  return {
    x: base.x + base.width / 2 - zone.x,
    y: base.y + base.height / 2 - zone.y,
  };
}

interface Sample {
  t: number;
  baseX: number;
  baseY: number;
}

/**
 * Record the ring's position every animation frame, to watch it move.
 *
 * The 200 ms return is transient — polling for it from the test side races the
 * thing it is measuring. Sampling in the page and asserting over the whole
 * trace is deterministic.
 *
 * This forces layout twice a frame, which is fine for the one test that needs
 * geometry but is not a general-purpose watcher: see `watchTint` for why.
 */
async function startSampling(page: Page, durationMs: number): Promise<void> {
  await page.evaluate((duration) => {
    const store = window as unknown as { __samples?: Sample[] };
    const base = document.querySelector<HTMLElement>('[data-joystick-base]')!;
    const zone = document.getElementById('control-zone')!;
    const started = performance.now();
    store.__samples = [];

    const tick = (): void => {
      const b = base.getBoundingClientRect();
      const z = zone.getBoundingClientRect();
      store.__samples!.push({
        t: performance.now() - started,
        baseX: b.left + b.width / 2 - z.left,
        baseY: b.top + b.height / 2 - z.top,
      });
      if (performance.now() - started < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, durationMs);
}

async function collectSamples(page: Page, durationMs: number): Promise<Sample[]> {
  await page.waitForTimeout(durationMs + 100);
  return page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);
}

/**
 * Watch the knob's buffered tint, as a log of every state it passes through.
 *
 * A `MutationObserver` rather than a per-frame sample, and not only because it
 * cannot miss a transition that begins and ends between two frames. The
 * sampling version had to run *before* the gesture it was measuring, and a
 * rAF loop forcing layout every frame starves WebKit's input dispatch enough
 * that Playwright's synthetic pointer events stopped arriving at all — the
 * stick never engaged, so the tint it was waiting for could never appear. The
 * observer costs nothing until the class actually changes.
 */
async function startTintWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __tint?: boolean[] };
    const knob = document.querySelector<HTMLElement>('[data-joystick-knob]')!;
    const tinted = (): boolean => knob.classList.contains('joystick__knob--buffered');

    store.__tint = [tinted()];
    new MutationObserver(() => store.__tint!.push(tinted())).observe(knob, {
      attributes: true,
      attributeFilter: ['class'],
    });
  });
}

/** Every tint state seen since the watch began, plus the state it ended in. */
async function collectTint(page: Page, durationMs: number): Promise<boolean[]> {
  await page.waitForTimeout(durationMs);
  return page.evaluate(() => {
    const store = window as unknown as { __tint: boolean[] };
    const knob = document.querySelector<HTMLElement>('[data-joystick-knob]')!;
    return [...store.__tint, knob.classList.contains('joystick__knob--buffered')];
  });
}

/** Press, drag `dx/dy` away from the ring's centre, and hold. */
async function pressAndDrag(
  page: Page,
  at: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();

  // The ring floats to the thumb and may be clamped away from it, so the drag
  // is measured from where the ring actually landed.
  const zone = await rectOf(page, '#control-zone');
  const centre = await baseCentre(page);
  await page.mouse.move(zone.x + centre.x + dx, zone.y + centre.y + dy, { steps: 6 });
}

test.describe('joystick fits and steers at every supported size', () => {
  for (const size of SIZES) {
    test(`is reachable from every corner of the band at ${size.label}`, async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
      page.on('pageerror', (e) => problems.push(String(e)));

      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/');
      await settled(page);

      const zone = await rectOf(page, '#control-zone');

      // The four corners and the middle. The whole band is the hit area, so a
      // thumb landing anywhere in it has to produce a working stick (§2.1).
      const inset = 4;
      const spots = [
        { label: 'centre', x: zone.width / 2, y: zone.height / 2 },
        { label: 'top-left', x: inset, y: inset },
        { label: 'top-right', x: zone.width - inset, y: inset },
        { label: 'bottom-left', x: inset, y: zone.height - inset },
        { label: 'bottom-right', x: zone.width - inset, y: zone.height - inset },
      ];

      for (const spot of spots) {
        await pressAndDrag(page, { x: zone.x + spot.x, y: zone.y + spot.y }, 60, 0);

        const ring = await rectOf(page, '[data-joystick-base]');
        const where = `${spot.label} @ ${size.label}`;

        // Clipping: the ring is clamped so the whole of it stays in the band.
        expect(ring.x, `${where}: ring runs off the left of the zone`).toBeGreaterThanOrEqual(
          zone.x - SLACK,
        );
        expect(ring.y, `${where}: ring runs off the top of the zone`).toBeGreaterThanOrEqual(
          zone.y - SLACK,
        );
        expect(
          ring.x + ring.width,
          `${where}: ring runs off the right of the zone`,
        ).toBeLessThanOrEqual(zone.x + zone.width + SLACK);
        expect(
          ring.y + ring.height,
          `${where}: ring runs off the bottom of the zone`,
        ).toBeLessThanOrEqual(zone.y + zone.height + SLACK);

        // ...and it is a real ring, not one collapsed to nothing by the clamp.
        expect(ring.width, `${where}: the ring has no size`).toBeGreaterThan(40);

        // Unreachability: a drag from here has to latch, not just look right.
        await expect
          .poll(
            () =>
              page
                .locator('[data-joystick-base]')
                .evaluate((node) => (node as HTMLElement).dataset['direction']),
            { message: `${where}: the stick did not latch a direction` },
          )
          .toBe('right');

        await page.mouse.up();
      }

      expect(problems).toEqual([]);
    });
  }
});

test.describe('joystick feedback', () => {
  test('the chevron follows the snapped direction, not the raw thumb', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    const zone = await rectOf(page, '#control-zone');
    const centre = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
    const base = page.locator('[data-joystick-base]');

    await expect(base).toHaveAttribute('data-direction', 'none');

    for (const [dx, dy, expected] of [
      [60, 0, 'right'],
      [0, -60, 'up'],
      [-60, 0, 'left'],
      [0, 60, 'down'],
    ] as const) {
      await pressAndDrag(page, centre, dx, dy);
      await expect(base, `dragging ${dx},${dy}`).toHaveAttribute('data-direction', expected);
      await page.mouse.up();
    }

    // The latch survives release, so the chevron keeps pointing the way he goes.
    await expect(base).toHaveAttribute('data-direction', 'down');
  });

  test('a near-diagonal drag holds the latched axis until it clears the margin', async ({
    page,
  }) => {
    await page.goto('/');
    await settled(page);

    const zone = await rectOf(page, '#control-zone');
    const centre = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
    const base = page.locator('[data-joystick-base]');

    await pressAndDrag(page, centre, 40, 0);
    await expect(base).toHaveAttribute('data-direction', 'right');

    // 1.10x the incumbent axis: inside the 15% margin, so it must not flicker.
    const from = await baseCentre(page);
    await page.mouse.move(zone.x + from.x + 40, zone.y + from.y + 44, { steps: 4 });
    await expect(base).toHaveAttribute('data-direction', 'right');

    // 1.25x: past the margin, so it switches.
    await page.mouse.move(zone.x + from.x + 40, zone.y + from.y + 50, { steps: 4 });
    await expect(base).toHaveAttribute('data-direction', 'down');

    await page.mouse.up();
  });

  test('the ring tints while a turn is buffered and clears when it resolves', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await waitUntilParked(page);

    const zone = await rectOf(page, '#control-zone');
    const centre = { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };

    await startTintWatch(page);
    // He is parked against a wall on his left, so a leftward request cannot be
    // honoured — it sits in the turn buffer until the 400 ms window expires,
    // which is exactly the state the tint is meant to make visible (§3.2).
    await pressAndDrag(page, centre, -60, 0);
    // Hold, as a thumb does. The stick is read once per simulation tick, so a
    // press and release inside a single frame is not a gesture it can see.
    await page.waitForTimeout(120);
    await page.mouse.up();

    const tint = await collectTint(page, 1200);

    expect(tint[0], 'the ring was already tinted before anything was asked for').toBe(false);
    expect(
      tint.some(Boolean),
      'the ring never tinted for a request that could not be honoured yet',
    ).toBe(true);
    expect(
      tint.at(-1),
      'the tint outlived the request; it must clear when the buffer expires',
    ).toBe(false);
  });

  test('the ring animates back to rest rather than snapping', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    const zone = await rectOf(page, '#control-zone');
    const rest = await baseCentre(page);

    await pressAndDrag(
      page,
      { x: zone.x + zone.width / 2, y: zone.y + zone.height * 0.25 },
      60,
      0,
    );
    const held = await baseCentre(page);
    expect(
      Math.hypot(held.x - rest.x, held.y - rest.y),
      'the ring never left its resting place',
    ).toBeGreaterThan(20);

    await startSampling(page, 500);
    await page.mouse.up();
    const samples = await collectSamples(page, 500);

    const distance = (s: Sample): number => Math.hypot(s.baseX - rest.x, s.baseY - rest.y);
    // A 200 ms transition passes through the middle; an instant jump does not.
    const intermediate = samples.filter((s) => {
      const d = distance(s);
      return d > 2 && d < Math.hypot(held.x - rest.x, held.y - rest.y) - 2;
    });

    expect(intermediate.length, 'the ring jumped home instead of easing back').toBeGreaterThan(0);
    expect(distance(samples.at(-1)!), 'the ring never made it home').toBeLessThan(2);
  });
});

test.describe('alternative inputs share the same pipeline', () => {
  /**
   * Each of these asserts through the turn buffer rather than through pixels.
   * The tint is set from `state.pacman.pendingDir`, so seeing it means the
   * input reached the *simulation* — the whole point of the intent pipeline is
   * that the sim cannot tell the sources apart (architecture §4).
   */
  async function bufferedAfter(page: Page, act: () => Promise<void>): Promise<boolean> {
    await startTintWatch(page);
    await act();
    return (await collectTint(page, 1000)).some(Boolean);
  }

  /** Flick on the maze, from its centre, by `dx` px. */
  async function flick(page: Page, dx: number): Promise<void> {
    const board = await rectOf(page, '#board');
    const from = { x: board.x + board.width / 2, y: board.y + board.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y, { steps: 6 });
    await page.mouse.up();
  }

  test('a swipe on the maze steers', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await waitUntilParked(page);

    // Well past the 24 px threshold, leftward into the wall he is parked on.
    const buffered = await bufferedAfter(page, () => flick(page, -60));
    expect(buffered, 'a flick on the maze never reached the simulation').toBe(true);
  });

  test('a flick shorter than the threshold is ignored', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await waitUntilParked(page);

    const buffered = await bufferedAfter(page, () => flick(page, -12)); // Under 24 px.
    expect(buffered, 'a tap on the maze was treated as a swipe').toBe(false);
  });

  test('the keyboard steers', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await waitUntilParked(page);

    const buffered = await bufferedAfter(page, () => page.keyboard.press('ArrowLeft'));
    expect(buffered, 'ArrowLeft never reached the simulation').toBe(true);
  });

  test('the page does not scroll when the maze is swiped', async ({ page }) => {
    await page.goto('/');
    await settled(page);

    const board = await rectOf(page, '#board');
    await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
    await page.mouse.down();
    await page.mouse.move(board.x + board.width / 2, board.y - 200, { steps: 10 });
    await page.mouse.up();

    // Spec §2.4: the document never scrolls, and a steering gesture is exactly
    // the one most likely to be mistaken for one.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('handedness (product spec §3.4)', () => {
  /** Settings are read once at boot, so they have to be in place before it. */
  async function withHandedness(page: Page, handedness: 'left' | 'right'): Promise<void> {
    await page.addInitScript((value) => {
      localStorage.setItem('pacman.settings', JSON.stringify({ handedness: value }));
    }, handedness);
  }

  test('mirrors the tablet resting corner', async ({ page }) => {
    await withHandedness(page, 'right');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await settled(page);

    await expect(page.locator('#app')).toHaveAttribute('data-handedness', 'right');

    const zone = await rectOf(page, '#control-zone');
    const ring = await rectOf(page, '[data-joystick-base]');

    // Bottom-*right* now, and still clear of the edge per the 16 px rule.
    expect(zone.x + zone.width - (ring.x + ring.width)).toBeLessThan(zone.width / 4);
    expect(zone.x + zone.width - (ring.x + ring.width)).toBeGreaterThanOrEqual(16);
    expect(ring.x + ring.width).toBeLessThanOrEqual(zone.x + zone.width + SLACK);
  });

  test('mirrors the landscape columns', async ({ page }) => {
    await withHandedness(page, 'right');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await settled(page);

    const app = page.locator('#app');
    await expect(app).toHaveAttribute('data-orientation', 'landscape');

    const zone = await rectOf(page, '#control-zone');
    const board = await rectOf(page, '#board');
    const hud = await rectOf(page, '.hud');

    // HUD | maze | joystick gutter — the left-handed order, reversed.
    expect(hud.x + hud.width).toBeLessThanOrEqual(board.x + SLACK);
    expect(board.x + board.width).toBeLessThanOrEqual(zone.x + SLACK);
    expect(zone.width).toBeGreaterThanOrEqual(120);
  });

  test('leaves the default alone', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await settled(page);

    await expect(page.locator('#app')).toHaveAttribute('data-handedness', 'left');
  });
});
