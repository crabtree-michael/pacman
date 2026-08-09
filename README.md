# Pac-Man Mobile Web

A mobile-first, touch-controlled Pac-Man for the browser. No install, no
account, no backend.

This repository currently holds the **skeleton**: build tooling, the fixed-step
simulation, the layered renderer, the input pipeline and the responsive layout,
wired together and running, with the test harness around them. Gameplay is not
— see [Status](#status).

## Design documents

- [Product Spec](docs/product-spec.md) — screen layout, joystick interaction,
  game mechanics, responsiveness and performance expectations.
- [Technical Architecture](docs/technical-architecture.md) — rendering, game
  loop, input pipeline, assets, project structure, build and deploy.

Read the product spec first; the architecture doc assumes its requirements. The
code follows the architecture's §6 structure, and comments cite the section
they implement.

## Getting started

Node 22.12 or newer (`.nvmrc` pins the major).

```sh
npm install
npm run dev          # http://localhost:5173

npm run setup:e2e    # once: downloads the browsers Playwright drives
npm run check        # typecheck, unit tests, build, browser tests
```

| Script                 | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `npm run dev`          | Vite dev server with hot module replacement      |
| `npm run build`        | Typecheck, then build to `dist/`                 |
| `npm run preview`      | Serve the production build on `:4173`            |
| `npm run typecheck`    | Typecheck the app and the tests                  |
| `npm test`             | Vitest once                                      |
| `npm run test:watch`   | Vitest in watch mode                             |
| `npm run test:e2e`     | Playwright, on Android and iOS emulation         |
| `npm run test:e2e:report` | Open the last Playwright HTML report           |
| `npm run setup:e2e`    | Install the Playwright browsers                  |
| `npm run check`        | Everything above, in the order CI would run them |

Arrow keys or WASD work on desktop; on a touchscreen you get the virtual
joystick.

### On a phone

Both servers bind to all interfaces, so a handset on the same network can reach
them. Vite prints the address on startup:

```
➜  Network: http://192.168.1.42:5173/
```

Do this early and often. The touch controls and the viewport fit cannot be
judged on a desktop, and neither can the two things most likely to bite —
iOS Safari's address bar collapsing mid-game, and how the control zone sits
relative to the home indicator.

`npm run preview` serves the built bundle on `:4173` for the same purpose. Use
it before anything that looks like a release: minification, real module
loading, and the absence of HMR are exactly what the dev server hides. Both
ports are `strictPort`, so a busy port fails loudly instead of quietly moving
the URL you bookmarked on your phone.

Note that HTTPS-only APIs — service worker, Vibration, Wake Lock — will not
work over plain `http://` to a LAN address. Nothing in the skeleton needs them
yet; the PWA ticket will need a tunnel or a local certificate.

## Structure

```
src/
  main.ts                   Bootstrap: mount layers, wire input, start the loop
  app/
    loop.ts                 Fixed-timestep driver, visibility handling
    layout.ts               Viewport band maths (product spec §2)
    persistence.ts          localStorage: high score
  sim/                      Pure, DOM-free (architecture §3)
    step.ts                 One tick: step(state, input, dt) -> state
    movement.ts             Grid motion, turn buffering, tunnel wrap
    state.ts                Initial state and cheap cloning
    maze.ts                 Tile queries and the pellet bitmap
    levels.ts               Per-level tuning table
    rng.ts                  Seeded xorshift32
    types.ts                GameState and the shared vocabulary
  render/
    renderer.ts             Owns the three layers and the shared viewport
    viewport.ts             Tile<->pixel transforms, DPR handling
    maze-layer.ts           Procedural maze, redrawn per level
    entity-layer.ts         Pellets and actors, per frame, interpolated
    overlay-layer.ts        READY!/GAME OVER, redrawn on change
  input/
    controller.ts           Arbitration and latching
    joystick.ts             Dead zone, 4-way snapping, hysteresis (no DOM)
    joystick-view.ts        Pointer handlers and CSS transforms
    keyboard.ts             Desktop convenience
  ui/hud.ts                 Score, high score, lives (DOM, not canvas)
  data/maze-classic.ts      28 x 31 board, 244 collectibles
  styles/main.css           Bands, safe areas, joystick
tests/
  sim/                      Movement and PRNG, headless
  app/                      Layout and viewport snapshots
  input/                    Joystick maths, synthetic pointer sequences
  replays/                  Replay driver, digest, recorded streams
  boundary/                 The sim/ isolation rule, enforced
  dom/                      jsdom: the HUD
  e2e/                      Playwright: mobile emulation smoke test
```

Four invariants hold this together, and each has a cost to give up:

- **The simulation is pure.** `sim/` has no DOM, no timers, and no randomness
  beyond a seeded PRNG, so `step(state, input, dt)` is reproducible. That is
  what makes replay tests possible, and what would later make server-side score
  validation possible. Nothing in `sim/` may import from `render/`, `input/`,
  or `ui/` — enforced by `tests/boundary`, not by convention.
- **Positions are integers.** Actors sit at whole sub-tile units (1/256th of a
  tile), so "exactly at a tile centre" is an exact test rather than an epsilon
  comparison, and there is no float drift.
- **The loop is fixed-step, the renderer interpolates.** The sim runs at 60 Hz
  everywhere; a 120 Hz panel renders twice per tick and blends between the two
  most recent states.
- **Input is intent, not action.** Pointer handlers only store a raw position.
  Snapping, dead zone and hysteresis run once per tick, and the result is a
  direction *request* the simulation applies when it becomes legal.

## Testing

| Layer                | Runner                   | What it covers                                                      |
| -------------------- | ------------------------ | ------------------------------------------------------------------- |
| `tests/sim`          | Vitest, Node             | Turn legality, wall stops, turn-buffer expiry, tunnel wrap, the PRNG |
| `tests/app`          | Vitest, Node             | Layout bands and viewport fitting, snapshotted over a device matrix  |
| `tests/input`        | Vitest, Node             | Dead zone, 4-way snapping, hysteresis, latching                      |
| `tests/replays`      | Vitest, Node             | A scripted input stream run headless, hashed to one digest           |
| `tests/boundary`     | Vitest, Node             | The `sim/` isolation rule                                            |
| `tests/dom`          | Vitest, jsdom            | The HUD                                                              |
| `tests/e2e`          | Playwright, WebKit + Chromium | Mounting, layout, the render loop, and pointer-driven steering  |

Two things about this setup are deliberate.

**The node and jsdom projects are separate.** `sim/` must keep running with no
DOM in scope at all, and a jsdom-everywhere config would happily let a
`document` reference slip into the simulation without failing.

**The replay digest is a change detector, not a spec.** `tests/replays` runs a
scripted stream of `(tick, direction)` pairs through the simulation and hashes
the final state — the one cheap test that catches any accidental behaviour
change. When gameplay lands the digest *will* move; re-baseline it in the same
commit as the behaviour change, never as a drive-by fix. The same goes for the
layout snapshots.

`npm run setup:e2e` fetches the browser binaries into `~/.cache/ms-playwright`,
outside the repo. On a fresh Linux box they also need system libraries —
`sudo npx playwright install-deps chromium webkit`, which wants root and is why
it is not folded into `npm install`. Playwright says which libraries are
missing if you skip it.

Playwright runs on both engines. WebKit is the one that matters: every platform
risk in architecture §10 — touch events swallowed near screen edges, address
bar collapse, audio staying suspended — is an iOS Safari problem. Emulation is
not a handset, but it catches what is not device-specific. `E2E_TARGET=preview
npm run test:e2e` runs the same specs against the production build.

### The `sim/` boundary

Architecture §6 specifies this as an ESLint import-boundary rule.
**typescript-eslint hard-errors on TypeScript 7**, which this project builds
with, and the documented workaround needs TS 6 aliased over the project's own
compiler — not a trade worth making to gain a lint rule
([typescript-eslint#10940][ts-eslint]).

So the rule is a test instead. `tests/boundary` scans `src/sim/**` and fails on
an import from `render/`, `input/`, `ui/`, `audio/` or `app/`, or on a
reference to `window`, `document`, `localStorage`, `Math.random`, `Date.now`,
`setTimeout` and friends. It checks the same constraint, runs in the same
`npm test`, and adds no dependency that would pin the project to an older
compiler. Both failure modes are verified against deliberate violations. Swap
it for the lint rule when the toolchain allows, not before.

The type-level half of the same rule is the two-project tsconfig: `src/` gets
`vite/client` types only, so nothing shipped can reach for a Node API;
`tsconfig.tools.json` gives the tests and configs the Node globals they need.

[ts-eslint]: https://github.com/typescript-eslint/typescript-eslint/issues/10940

## Status

Working: build tooling, the fixed-timestep loop with visibility suspend, the
three-layer renderer with DPR-capped viewport fitting, grid-locked movement
with turn buffering and tunnel wrap, the floating joystick with dead zone and
hysteresis, keyboard input, the HUD, and the portrait/landscape layout.

Not built yet, each marked with a `TODO(area)` comment where it belongs:

- `TODO(mechanics)` — pellet collection, scoring, collisions, lives, the level
  table, and cornering
- `TODO(ghosts)` — the shared movement engine, the four targeting rules,
  scatter/chase scheduling, house release, and the no-up tiles
- `TODO(render)` — the sprite atlas, arcade wall shapes, bitmap glyphs
- `TODO(audio)` — the audio sprite and the event-driven director
- `TODO(ui)` — attract, pause, game over and intermission screens

The test harness is in place — see [Testing](#testing). Still outstanding from
the architecture doc: the PWA service worker and manifest (§8.2, build order
step 9), the CI bundle-size gate (§7 — the budget is 120 kB gzipped and the
bundle is currently 6.2 kB, so nothing enforces it yet), and ESLint, which is
blocked on TypeScript 7 support.

The suites themselves are only as deep as the skeleton is. The architecture's
§9 rows for ghost targeting, scoring and cornering have no code to test yet;
each lands with its own ticket, in the directory laid out for it.

### Verified

Most of the list below started as one-off checks during the skeleton ticket.
They are now regression tests — `npm run check` re-runs them — except the two
noted as still manual.

- 244 collectibles (240 pellets + 4 power pellets), matching product spec §4.1;
  board symmetric, every collectible reachable, tunnel open at both edges
- 180 s of seeded random steering: no wall clipping, 228 of 300 open tiles
  reached; tunnel wrap keeps positions in bounds *(one-off; the standing
  regression test is the shorter scripted replay in `tests/replays`)*
- Turn buffer expires at 383 ms against the spec's 400 ms window (one tick of
  accounting), and a pre-turn is honoured at the next junction
- Reversal turns on the spot mid-corridor, as the spec requires
- Two identical runs produce bit-identical state
- Joystick hysteresis holds at a 1.10x challenge and switches at 1.20x, per the
  spec's 15% margin
- Viewport caps DPR at 3 and snaps the tile size to whole device pixels
- Production bundle is 6.2 kB gzipped, against the architecture's 120 kB budget
  *(manual — the CI gate from architecture §7 is not built)*
- The page mounts, fits and runs its loop on Android and iOS emulation, and a
  synthetic drag on the joystick steers Pac-Man, with no console errors

### Known discrepancy

The layout implements the sizing rule stated in product spec §2.1, and matches
the maze dimensions in that section's worked-example table for 390x844,
430x932 and 768x1024. It does **not** reproduce the table's control-zone
figures for those rows (it computes 328/372/364 against the table's
296/358/364), and for 360x640 it grows the maze to 340x376 where the table says
316x350. The stated rule gives the maze all the height left over above the
180 px control-zone minimum, which is what the code does; the table's numbers
imply an additional per-device reservation the rule does not mention. Worth
settling with the spec owner — the fix is one constant either way.

## Deployment

`render.yaml` describes the site as a Render static site: `npm run build`,
publish `dist/`. There is no server component. Architecture §8.1 lists
Cloudflare Pages, Netlify, Vercel and GitHub Pages as equivalent options and
does not mention Render; Render is used here because the repository is already
configured for it via `.amika/config.toml`.
