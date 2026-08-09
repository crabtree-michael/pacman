# Pac-Man Mobile Web

A mobile-first, touch-controlled Pac-Man for the browser. No install, no
account, no backend.

This repository currently holds the **skeleton**: build tooling, the fixed-step
simulation, the layered renderer, the input pipeline and the responsive layout,
wired together and running. Gameplay is not — see [Status](#status).

## Design documents

- [Product Spec](docs/product-spec.md) — screen layout, joystick interaction,
  game mechanics, responsiveness and performance expectations.
- [Technical Architecture](docs/technical-architecture.md) — rendering, game
  loop, input pipeline, assets, project structure, build and deploy.

Read the product spec first; the architecture doc assumes its requirements. The
code follows the architecture's §6 structure, and comments cite the section
they implement.

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

The dev server binds to all interfaces, so you can open it on a phone at
`http://<your-machine-ip>:5173` — worth doing early and often, since the touch
controls and the viewport fit cannot be judged on a desktop.

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Vite dev server with hot module replacement |
| `npm run build`     | Typecheck, then build to `dist/`            |
| `npm run preview`   | Serve the production build locally          |
| `npm run typecheck` | Typecheck only                              |

Arrow keys or WASD work on desktop; on a touchscreen you get the virtual
joystick.

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
```

Four invariants hold this together, and each has a cost to give up:

- **The simulation is pure.** `sim/` has no DOM, no timers, and no randomness
  beyond a seeded PRNG, so `step(state, input, dt)` is reproducible. That is
  what makes replay tests possible, and what would later make server-side score
  validation possible. Nothing in `sim/` may import from `render/`, `input/`,
  or `ui/`.
- **Positions are integers.** Actors sit at whole sub-tile units (1/256th of a
  tile), so "exactly at a tile centre" is an exact test rather than an epsilon
  comparison, and there is no float drift.
- **The loop is fixed-step, the renderer interpolates.** The sim runs at 60 Hz
  everywhere; a 120 Hz panel renders twice per tick and blends between the two
  most recent states.
- **Input is intent, not action.** Pointer handlers only store a raw position.
  Snapping, dead zone and hysteresis run once per tick, and the result is a
  direction *request* the simulation applies when it becomes legal.

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

Also outstanding from the architecture doc but deferred to their own tickets:
Vitest/Playwright and the ESLint `sim/` import boundary (testing setup), and
the PWA service worker and manifest (architecture §8.2, build order step 9).

### Verified

- 244 collectibles (240 pellets + 4 power pellets), matching product spec §4.1;
  board symmetric, every collectible reachable, tunnel open at both edges
- 180 s of seeded random steering: no wall clipping, 228 of 300 open tiles
  reached; tunnel wrap keeps positions in bounds
- Turn buffer expires at 383 ms against the spec's 400 ms window (one tick of
  accounting), and a pre-turn is honoured at the next junction
- Reversal turns on the spot mid-corridor, as the spec requires
- Two identical runs produce bit-identical state
- Joystick hysteresis holds at a 1.10x challenge and switches at 1.20x, per the
  spec's 15% margin
- Viewport caps DPR at 3 and snaps the tile size to whole device pixels
- Production bundle is 6.2 kB gzipped, against the architecture's 120 kB budget

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
