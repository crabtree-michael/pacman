# Pac-Man Mobile Web

A mobile-first, touch-controlled Pac-Man for the browser. No install, no
account, no backend.

The game is playable, and the ghosts hunt: eat the maze, chase the score, lose
your three lives to Blinky, Pinky, Inky and Clyde. Build tooling, the fixed-step
simulation, the game-flow state machine, the layered renderer, the touch input
pipeline and the responsive layout are all in place, with the test harness
around them. What is left is chrome rather than mechanics — see
[Status](#status).

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
joystick, or a swipe anywhere on the maze. A gamepad D-pad works if one is
plugged in.

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
  main.ts                   Bootstrap: mount layers, wire input, open the gate
  app/
    game.ts                 Loop <-> simulation seam; pause, restart, boot gate
    loop.ts                 Fixed-timestep driver, visibility handling
    layout.ts               Viewport band maths (product spec §2)
    persistence.ts          localStorage: high score, input settings
  sim/                      Pure, DOM-free (architecture §3)
    step.ts                 One tick: step(state, input, dt) -> state
    phases.ts               Game flow: transition table + per-phase handlers
    movement.ts             Grid motion, turn buffering, tunnel wrap
    pacman.ts               Player update: eating, chewing, ghost contact
    scoring.ts              Points, the ghost ladder, the extra life
    modes.ts                Scatter/chase scheduling and the frightened timer
    ghosts/
      ghost.ts              The one movement engine all four ghosts run
      targeting.ts          Four target tiles: the whole of the personalities
      house.ts              Release order, the walk out, the eyes' return
    fruit.ts                Bonus fruit: thresholds, clock, collection
    state.ts                Initial state, resets, cheap cloning
    maze.ts                 Tile queries and the pellet bitmap
    levels.ts               Per-level tuning table
    rng.ts                  Seeded xorshift32
    types.ts                GameState and the shared vocabulary
  render/
    renderer.ts             Owns the three layers and the shared viewport
    viewport.ts             Tile<->pixel transforms, DPR handling
    maze-layer.ts           Procedural maze, redrawn per level
    entity-layer.ts         Pellets, fruit and actors, per frame, interpolated
    overlay-layer.ts        The card for the current phase, redrawn on change
    palette.ts              The fruit colours the board and the HUD share
  input/
    controller.ts           Arbitration and latching
    joystick.ts             Dead zone, 4-way snapping, hysteresis (no DOM)
    joystick-view.ts        Pointer handlers, placement, CSS transforms
    swipe.ts                Flick-to-steer on the maze
    keyboard.ts             Desktop convenience
    gamepad.ts              D-pad and left stick, polled once a tick
    haptics.ts              A 10 ms pulse on each direction change
  ui/hud.ts                 Score, high score, lives, level fruit (DOM)
  data/maze-classic.ts      28 x 31 board, 244 collectibles
  styles/main.css           Bands, safe areas, joystick
tests/
  sim/                      Movement, the phase machine, the PRNG — headless
  app/                      Layout and viewport snapshots
  input/                    Joystick maths, synthetic pointer sequences
  replays/                  Replay driver, digest, recorded streams
  boundary/                 The sim/ isolation rule, enforced
  dom/                      jsdom: the HUD, the loop, the app wiring
  e2e/                      Playwright: mobile emulation smoke test and the
                            size/orientation matrix
```

Five invariants hold this together, and each has a cost to give up:

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
- **Game flow is a table, not a tangle.** Every screen the game can be on is a
  `phase`, and the only way between two of them is an entry in the transition
  table in `sim/phases.ts`. Nothing outside that module assigns `state.phase`;
  the app can only send events and be ignored if they do not apply.

### Game flow

`Boot → Attract → Ready → Playing → {Dying → Ready | LevelComplete → Ready |
GameOver → Attract}`, with `Paused` suspending whatever sits underneath it
(product spec §4.6). Two consequences worth knowing:

- **Pause is free.** The simulation is a pure function of its state, so a paused
  game is one that is not being called. There are no clocks to freeze and no
  timers to cancel; `Paused` simply has no `update`. Backgrounding the tab
  cancels the RAF and pauses; coming back paints the pause card rather than
  dropping the player into a moving Pac-Man.
- **Resuming is not re-entering.** Pause and resume skip the underlying phase's
  `enter`/`exit` handlers, so pausing two seconds into the countdown resumes two
  seconds into the countdown instead of restarting it.

`Boot` and `Attract` both exist and both currently last a single microtask:
`main.ts` opens the boot gate as soon as its (empty) asset load resolves, then
starts the game itself. The attract screen and the TAP TO PLAY target that
should own that second gesture are `TODO(ui)`.

## Testing

| Layer                | Runner                   | What it covers                                                      |
| -------------------- | ------------------------ | ------------------------------------------------------------------- |
| `tests/sim`          | Vitest, Node             | Turn legality, wall stops, turn-buffer expiry, tunnel wrap, the phase machine, the PRNG, pellet collection and the chew stall, the frightened timer and the ghost ladder, ghost contact and the death path, fruit thresholds and expiry, the per-level tuning table, the ghost decision rule and its tie-break, the four targeting rules, scatter/chase scheduling and its reversals, house release and the eyes' journey home |
| `tests/app`          | Vitest, Node             | Layout bands and viewport fitting, snapshotted over a device matrix  |
| `tests/input`        | Vitest, Node             | Dead zone, snapping, hysteresis, latching, arbitration, resting placement, gamepad, haptics |
| `tests/replays`      | Vitest, Node             | A scripted input stream run headless, hashed to one digest           |
| `tests/boundary`     | Vitest, Node             | The `sim/` isolation rule                                            |
| `tests/dom`          | Vitest, jsdom            | The HUD; the loop, on a fake clock; the app's pause and boot wiring   |
| `*.dom.test.ts`      | Vitest, jsdom            | The DOM half of a layer, alongside its headless half (swipe, settings storage) |
| `tests/e2e`          | Playwright, WebKit + Chromium | Mounting, the render loop, pointer-driven steering, pause and resume, rotation, a nine-size layout matrix, and the same nine sizes swept for joystick reach and feedback |

Three things about this setup are deliberate.

**The node and jsdom projects are separate.** `sim/` must keep running with no
DOM in scope at all, and a jsdom-everywhere config would happily let a
`document` reference slip into the simulation without failing.

**A `*.dom.test.ts` suffix picks the environment, not a directory.** Some layers
have a headless half and a DOM half that belong together — `input/swipe.ts` is
pointer plumbing wrapped around maths — and splitting them by runner would put
one half of a module two directories from the other. The suffix keeps them
adjacent while leaving the node/jsdom split as sharp as it was.

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
game-flow state machine with pause and restart, the three-layer renderer with
DPR-capped viewport fitting, grid-locked movement with turn buffering and
tunnel wrap, the HUD, and the portrait/landscape layout.

Core gameplay is complete to spec §4.1–§4.5: pellets and power pellets scored
and cleared from the board, the chew that costs Pac-Man a frame of movement,
the frightened timer with the 200/400/800/1600 ghost ladder, the bonus fruit at
70 and 170 dots, the extra life at 10,000, three lives with a death freeze and a
respawn that keeps the board as it was left, and level progression driven by a
per-level tuning table that clamps at 21 and runs for ever. Contact with a ghost
costs a life; contact with a frightened one scores. The status strip shows lives
as Pac-Man wedges and the levels reached as their fruit.

The ghosts are complete to spec §4.3. All four run one movement engine — at each
tile centre, take the exit that minimises straight-line distance to a target
tile, never reverse, never turn up on one of the four no-up tiles, ties broken
up → left → down → right — and the whole of their personality is the target tile
`sim/ghosts/targeting.ts` hands back: Blinky on your tail, Pinky four ahead with
the arcade's overflow bug intact, Inky doubling a vector through Blinky, Clyde
breaking off inside eight tiles. Over the top of that run the global scatter/chase
cursor with its reversal on every transition, frightened mode's seeded random
turns, Cruise Elroy, the tunnel crawl, the house's dot counter and its
no-dots-eaten timeout, and the eyes' 160% journey home to be reassembled and let
straight back out.

Input is complete to spec §3: the floating joystick with dead zone, 4-way
snapping and hysteresis; the chevron, buffered-turn tint and 200 ms return that
make its state legible; direction latching across a lifted thumb; swipe, keyboard
and gamepad sharing the same intent pipeline; haptics; and the handedness and
large-stick accessibility options. The stick pins to a corner at tablet widths
(§2.1) and mirrors for a right-handed player (§3.4).

The settings *screen* is not built — it is `TODO(ui)` with the rest of the menus.
The options above are read from `localStorage` and honoured at boot, so that
screen only has to call `saveSettings`; until it exists they ship at their
defaults and can only be changed by hand.

Not built yet, each marked with a `TODO(area)` comment where it belongs:

- `TODO(mechanics)` — cornering, the one movement rule left. `CORNER_TOLERANCE`
  is still 0, so turns are taken exactly on the tile centre; the diagonal
  shortcut wants playtesting alongside open question 2 rather than a guess.
- `TODO(render)` — the sprite atlas, arcade wall shapes, bitmap glyphs, the
  level-complete maze flash and the score bubble over an eaten ghost. The
  one-second freeze that bubble is meant to fill already runs; nothing is drawn
  in it yet.
- `TODO(audio)` — the audio sprite and the event-driven director. The event
  queue it consumes is already drained once per tick in `app/game.ts`.
- `TODO(ui)` — the attract screen, the pause overlay's Resume/Restart/Sound
  controls, game over and intermission screens. The phases behind them all
  exist and are reachable; what is missing is the chrome.
- `TODO(assets)` — the boot gate in `main.ts` resolves immediately because
  nothing is loaded yet

The test harness is in place — see [Testing](#testing). Still outstanding from
the architecture doc: the PWA service worker and manifest (§8.2, build order
step 9), the CI bundle-size gate (§7 — the budget is 120 kB gzipped and the
bundle is currently 12.8 kB, so nothing enforces it yet), and ESLint, which is
blocked on TypeScript 7 support.

The architecture's §9 rows for scoring, progression and ghost AI are covered;
cornering is the one behaviour left with no code to test, and it lands with the
`TODO(mechanics)` ticket above.

### Verified

Most of the list below started as one-off checks during the skeleton ticket.
They are now regression tests — `npm run check` re-runs them — except the two
noted as still manual.

- 244 collectibles (240 pellets + 4 power pellets), matching product spec §4.1;
  board symmetric, every collectible reachable, tunnel open at both edges
- A pellet scores 10 and leaves the board, a power pellet scores 50 and starts
  a 6 s fright at level 1, and the eaten tile does not pay twice
- Eating writes a fresh pellet bitmap rather than the one the previous frame is
  still being interpolated from
- The frightened clock runs exactly 360 ticks at level 1, flashes for its last
  2 s, restarts rather than extends on a second pellet, and hands the ghosts
  back when it ends; from level 19 it never starts
- The ghost ladder pays 200/400/800/1600 under one pellet and resets with it
- The extra life lands once, on whatever crosses 10,000
- Fruit appears at 70 and again at 170 dots, sits on the tile below the house,
  expires uneaten after 9.5 s, and does not survive a death or a level change
- Ghost contact costs a life, freezes, and respawns with the board's remaining
  pellets intact; the last life ends the game
- 600 ticks of all four ghosts moving: no wall clipping, no ghost ever reverses
  except when a pellet or a mode transition tells it to, and the same seed walks
  the same routes twice while a different seed diverges
- Each targeting rule against hand-worked tiles, including Pinky's up-facing
  overflow, Inky's doubled vector through Blinky, and Clyde's break for the
  corner at exactly eight tiles — the rule is "more than eight"
- All four scatter corners sit outside the walls, so none is ever reached
- A ghost refuses to turn up on a no-up tile even with its target straight up
  it, and takes that same turn one tile over where the list does not apply
- Level 1 scatters for exactly seven seconds and then chases, every transition
  turns the loose ghosts round, and frightened time stops the cursor rather than
  running it down — the ghosts come back to whatever it says then
- Ghost speed follows the level, the tunnel crawl, frightened, eyes and both
  Elroy stages, and a frightened Blinky is as slow as any other frightened ghost
- Pinky leaves at once, Inky on the thirtieth dot, Clyde on the sixtieth, in that
  order; from level 3 the house empties immediately; the no-dots-eaten timeout
  releases the next one anyway and restarts with each release
- A ghost emerges above the door facing left in the current global mode, and is
  not something Pac-Man can run into while it is on its way out
- Eyes travel home at 160%, ignore the tunnel crawl on the way, drop to the
  revive spot and come straight back out in play
- Clearing the board ends the level, and the next one refills it while score,
  lives and the extra-life flag carry over
- Played in a real browser at 390x844: a scripted run eats its way to the
  bottom-left power pellet and turns Blinky blue, a wander summons the cherry
  under the house, and walking into a ghost takes a life off the strip
- 180 s of seeded random steering: no wall clipping, 228 of 300 open tiles
  reached; tunnel wrap keeps positions in bounds *(one-off; the standing
  regression test is the shorter scripted replay in `tests/replays`)*
- Turn buffer expires at 383 ms against the spec's 400 ms window (one tick of
  accounting), and a pre-turn is honoured at the next junction
- The timed phases last exactly what they claim: Ready is 180 ticks, not the 181
  that repeated float subtraction would otherwise cost
- One second of wall clock is 60 ticks at 100 fps and 60 ticks at 33 fps, and a
  four-second stall is clamped to 15 ticks rather than 240
- Pausing freezes the simulation while the loop keeps painting, and resuming
  leaves the countdown, positions and score exactly as they were
- Reversal turns on the spot mid-corridor, as the spec requires
- Two identical runs produce bit-identical state
- Joystick hysteresis holds at a 1.10x challenge and switches at 1.20x, per the
  spec's 15% margin, in the maths and again through a real drag in the browser
- The ring stays wholly inside the control zone, and steers, from all four
  corners and the middle of the band, at all nine supported sizes on both
  engines — the spec's "no clipping or unreachable controls" criterion
- The chevron tracks the snapped direction, the knob tints while a turn is
  buffered and clears when the buffer expires, and the ring eases home over
  200 ms rather than jumping
- Swipe, keyboard and joystick all reach the simulation through the same
  pipeline; a flick under the 24 px threshold does not, and swiping the maze
  never scrolls the page
- Viewport caps DPR at 3 and snaps the tile size to whole device pixels
- Production bundle is 12.8 kB gzipped, against the architecture's 120 kB budget
  *(manual — the CI gate from architecture §7 is not built)*
- The page mounts, fits and runs its loop on Android and iOS emulation, and a
  synthetic drag on the joystick steers Pac-Man, with no console errors
- Nine sizes spanning the spec's 320x568–1024x1366 support range, in both
  orientations and on both engines: the maze layer is actually painted, nothing
  overflows the viewport, and the document never scrolls
- Rotating to landscape and back re-fits the board rather than leaving it at its
  previous size

### Settled: the sizing rule beats the worked examples

The layout implements the sizing rule stated in product spec §2.1 — the maze
gets all the height left over above the 180 px control-zone minimum. That rule
disagreed with the control-zone column of the same section's worked-example
table, which implied a per-device reservation the rule never mentions. The spec
owner has ruled the written rule authoritative, so the table has been corrected
to the figures the rule produces (control zones of 180/328/372/364 px, and a
340x376 maze on 360x640). `CONTROL_ZONE_MIN` stays at 180 and the code is
unchanged.

### Departed: the joystick scales off the screen's short edge

Product spec §3.1 sizes the stick by `clamp(0.85, screenWidth / 390, 1.25)`.
Read literally that is `innerWidth`, which in landscape is the *long* edge — so
a 568x320 phone, whose joystick gutter is the narrowest in the whole supported
range at about 150 px, asked for the 1.25x maximum and a 160 px ring. The ring
did not fit the gutter it had to live in.

The code uses `min(innerWidth, innerHeight)` instead. That is the same number in
both orientations and tracks the device rather than how it is being held, which
is what the rule's stated intent — "the same physical size on a small Android and
a Pro Max" — is after; portrait behaviour is identical. A second clamp then fits
the ring to its zone outright, so no future band arithmetic can produce a stick
too big for the band. Both are covered by the joystick sweep in `tests/e2e`.

Worth a spec-owner confirmation, since it is the wording rather than the intent
that changed.

### Defaulted: swipe-to-steer is on

Product spec open question 4 asks whether a swipe on the maze ships enabled or
opt-in, and is unresolved. It ships **enabled**, behind a settings flag either
way. Nothing else on the maze is interactive, so a swipe cannot be mistaken for
another gesture, and the cost of the wrong default is one toggle rather than a
missing feature. Flip `DEFAULT_SETTINGS.swipe` if playtesting disagrees.

### Filled in: the tuning table the spec points at

Product spec §4.2 defers speeds to "the speed table in the architecture doc's
tuning appendix". There is no such appendix. `sim/levels.ts` is that table, built
from the arcade's numbers, with the rule that where the spec states a value it
wins and where it is silent the arcade does — so Pac-Man is at 80% on level 1,
90% on 2–4 and 100% from 5 exactly as §4.2 says, while the ghost, tunnel and
frightened speeds come from the original.

Two things in it are worth a spec owner's eye:

- **Frightened time is not monotonic.** §4.3 says the duration "shrinks with
  level (6 s at level 1, 0 s from level 19)". The arcade's table dips to 1 s at
  level 9 and back to 5 s at level 10, and those two levels are famous breathing
  room. Both of the spec's anchors hold; the curve between them does not shrink
  strictly. Say the word and it becomes a straight ramp.
- **Speeds do not drop back at level 21.** The arcade returns Pac-Man to 90%
  there; §4.2's "100% from level 5" plus §4.5's "clamps to its hardest values"
  read as staying at 100%, which is what the table does.

The Cruise Elroy thresholds and both Elroy speeds are in the table too, unused
until the ghost ticket reads them. They are data the spec asks for (§4.3), and
data is cheaper to land now than to retrofit under a ghost that already ships.

### Chosen: contact is a shared tile, and the pass-through stays

A ghost catches Pac-Man when the two occupy the same tile, which is how the
arcade does it. The consequence is the famous pass-through: two actors that swap
tiles within one tick cross without touching. A distance test would quietly
close a gap players have been exploiting for forty years, so the tile test is
deliberate rather than an approximation waiting to be tightened.

### Chosen: the power-pellet chew costs three ticks

Spec §4.2 keeps the arcade's chewing pause and prices a pellet at "one frame of
movement". It says nothing about the power pellet, which the arcade charges
three frames for. Three is what ships — the pause is part of why a power pellet
is worth timing rather than grabbing on sight, and the spec's own reason for
keeping the effect at all is that it changes ghost-escape maths. Both values are
named constants in `sim/pacman.ts`.

The fruit's dot thresholds count power pellets as dots, on the same reading:
§4.4 says "after 70 ... pellets are eaten", and the arcade counts all 244
collectibles.

### Fixed on the way past: Pac-Man's shut mouth drew nothing

The chomp wedge was `arc(centre, radius, facing + halfMouth, facing -
halfMouth)`, and on the one frame in sixteen where the mouth is fully shut
`halfMouth` was exactly 0 — a zero-length arc, which draws nothing at all. He
blinked out for a tick every quarter second, and stayed invisible if he parked
against a wall on that frame, which is how it was found: `movePacman` stops
advancing `animTicks` when he is blocked. The wedge now has a floor.

## Deployment

`render.yaml` describes the site as a Render static site: `npm run build`,
publish `dist/`. There is no server component. Architecture §8.1 lists
Cloudflare Pages, Netlify, Vercel and GitHub Pages as equivalent options and
does not mention Render; Render is used here because the repository is already
configured for it via `.amika/config.toml`.
