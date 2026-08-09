# Pac-Man Mobile Web — Technical Architecture

**Status:** Draft for review
**Companion document:** `product-spec.md` (read that first; this document assumes its requirements)
**Owner:** TBD

---

## 1. Architectural principles

Four decisions drive everything else:

1. **The simulation is pure and deterministic.** Game state advances via
   `step(state, input, dt) → state` with no DOM, no timers, no randomness beyond
   a seeded PRNG. This gives us record/replay tests, frame-rate independence,
   and a trivial pause.
2. **Fixed-timestep simulation, decoupled rendering.** Physics never depends on
   how fast the device paints. Required by the spec's "same speed at 40 fps"
   rule and by the tile-alignment logic, which is fragile under variable steps.
3. **One canvas, no per-entity DOM.** Sprites are drawn, not laid out. DOM is
   used only for chrome (HUD, overlays, settings) where its accessibility and
   text rendering are worth it.
4. **Input is intent, not action.** Touch handlers never move Pac-Man. They
   produce a `DirectionRequest` that the simulation consumes when it is legal to
   do so. This is what makes joystick, swipe, keyboard, and replay files
   interchangeable.

Stack: **TypeScript + Vite + Canvas 2D**, no game framework, no UI framework.
The whole game is roughly 3–4k lines; Phaser (~1 MB) or PixiJS would cost more
in payload and indirection than they save. See §11 for the rejected options.

---

## 2. Rendering

### 2.1 Choice: Canvas 2D

| Option | Verdict |
| --- | --- |
| **Canvas 2D** | **Chosen.** ~50 sprites/frame is far below its limits; universal support; trivial DPR handling; smallest payload. |
| WebGL / PixiJS | Overkill. Adds 150–400 KB and shader/context-loss complexity for a draw load 2D handles at 60 fps with room to spare. |
| DOM + CSS transforms | Viable at this sprite count but fights us on the pixel-art look, per-pixel maze rendering, and layout thrash on resize. |
| SVG | Poor fill-rate for animated sprites; no benefit here. |
| Phaser / Kaboom | Brings a scene graph, physics, and asset pipeline we do not need, and its game loop would have to be fought to get our fixed-step determinism. |

### 2.2 Layered canvases

Three stacked `<canvas>` elements, all in the same CSS-positioned container:

| Layer | Redraw frequency | Contents |
| --- | --- | --- |
| `maze` | Once per level (and on resize) | Walls, ghost-house gate, tunnel mouths |
| `entities` | Every frame | Pellets, Pac-Man, ghosts, fruit, score popups |
| `overlay` | On change only | READY!/GAME OVER text, level flash tint |

The maze is the most expensive thing to draw and never changes during play, so
it is rendered once into an `OffscreenCanvas` (falling back to a detached
`<canvas>`) and blitted — or, since it is its own layer, simply left alone. This
alone removes ~70% of per-frame draw work.

Pellets live on the entity layer rather than the maze layer: they are cheap
(244 small arcs, batched into a single path per frame) and baking them into the
maze would force a full maze re-render on every pellet eaten.

### 2.3 Coordinates and scaling

- The simulation works in **tile space** (28 × 31) with sub-tile precision.
- The renderer holds a single `Viewport` object: `{ tileSize, originX, originY, dpr }`.
- Canvas backing store is `cssSize × min(devicePixelRatio, 3)`; the CSS size
  comes from the layout rules in the product spec §2. A single
  `ctx.setTransform(scale, 0, 0, scale, originX, originY)` per frame means all
  draw code can work in tile units and stay resolution-agnostic.
- `imageSmoothingEnabled = false`, and `tileSize` is rounded to an integer number
  of device pixels when the exact fit is within 8% — this keeps pixel art crisp
  and avoids shimmer while scrolling sprites. The residual few pixels become
  letterbox margin.

### 2.4 Interpolation

The renderer draws at `state_previous + (state_current − state_previous) × alpha`
where `alpha` is the leftover accumulator fraction. Only positions and animation
phases are interpolated; discrete facts (pellet eaten, ghost mode) snap. Without
this, a 60 Hz sim on a 120 Hz screen judders visibly.

### 2.5 Dirty-rect option

Not in v1. Full-canvas clear of the entity layer at 390 × 432 CSS px is a
sub-millisecond operation. If profiling on low-end devices says otherwise, the
entity layer is the natural place to add dirty rects, since every mover's
previous bounds is already known from the interpolation buffer.

---

## 3. Game loop and state management

### 3.1 The loop

```ts
const STEP_MS = 1000 / 60;   // fixed simulation tick
const MAX_FRAME_MS = 250;    // spiral-of-death clamp

function frame(now: number) {
  raf = requestAnimationFrame(frame);

  let delta = Math.min(now - last, MAX_FRAME_MS);
  last = now;
  accumulator += delta;

  while (accumulator >= STEP_MS) {
    previous = current;
    current = step(current, input.consume(), STEP_MS);
    accumulator -= STEP_MS;
  }

  render(previous, current, accumulator / STEP_MS);
}
```

Notes on the details that matter:

- **`MAX_FRAME_MS` clamp** prevents the "spiral of death" after a long stall
  (tab restore, GC pause): the game skips lost time rather than trying to
  simulate 4 seconds in one frame.
- **`document.visibilitychange` cancels the RAF entirely** and transitions to
  `Paused`. No background CPU, no battery drain, no giant delta on return.
- **`input.consume()`** hands the simulation a snapshot; the input layer keeps
  mutating independently on its own event cadence.
- 60 Hz is the simulation rate on all devices. On a 120 Hz panel the loop runs
  twice per sim step and interpolation carries the difference.

### 3.2 State shape

A single plain object, structured so it can be cloned cheaply and serialised for
tests:

```ts
interface GameState {
  phase: Phase;                    // Attract | Ready | Playing | Dying | LevelComplete | GameOver | Paused
  phaseTimer: number;              // ms remaining in timed phases
  level: number;
  score: number; lives: number; extraLifeAwarded: boolean;
  maze: MazeState;                 // pellet bitmap + remaining count
  pacman: Pacman;                  // tile pos, sub-tile offset, dir, pendingDir, animPhase
  ghosts: [Ghost, Ghost, Ghost, Ghost];
  modeTimer: ModeScheduler;        // scatter/chase cursor
  fright: { active: boolean; msRemaining: number; ghostsEaten: number };
  fruit: FruitState | null;
  rng: number;                     // seeded PRNG state (single uint32)
  events: GameEvent[];             // drained each frame by audio/HUD
}
```

**Positions are integers.** Each entity stores `tileX, tileY` plus a sub-tile
offset in 1/256ths of a tile. Integer arithmetic removes float drift, makes
"is this entity exactly at a tile centre?" an exact comparison rather than an
epsilon test, and makes replays bit-identical across devices. This is worth the
minor arithmetic awkwardness; float positions are the most common source of
subtle Pac-Man clone bugs.

**Events, not callbacks.** The simulation never plays a sound or updates the
DOM. It appends to `state.events` (`PelletEaten`, `GhostEaten`, `Death`,
`LevelCleared`, …). After each frame the audio system and the HUD drain that
queue. Muting audio therefore cannot change game behaviour, and the sim stays
testable in Node with no mocks.

### 3.3 Phase machine

Game flow is an explicit state machine over `phase`, with a table of
`(phase, event) → phase` transitions and per-phase `enter`/`update`/`exit`
handlers. Phases like `Ready` and `Dying` are just timed phases whose `update`
does nothing but tick a clock — which is exactly why the arcade's freeze frames
are easy to reproduce faithfully.

### 3.4 Module layout of the simulation

```
sim/
  step.ts          orchestrates one tick, dispatches by phase
  movement.ts      grid-locked motion, turn legality, cornering, tunnel wrap
  pacman.ts        player update + pellet consumption
  ghosts/
    ghost.ts       shared movement engine + mode handling
    targeting.ts   blinky/pinky/inky/clyde target-tile functions
    house.ts       dot counters, release timing, respawn
  modes.ts         scatter/chase scheduler, frightened timer
  scoring.ts       points, multipliers, extra life
  levels.ts        per-level tuning table (speeds, fright duration, Elroy, fruit)
  maze.ts          tile queries: isWall, isTunnel, isNoUpTile, pellet bitmap
  rng.ts           seeded xorshift32
```

### 3.5 Movement and turn buffering

The single most important routine, since it defines the game's feel:

1. Each tick, an entity advances `speed` sub-units along its current direction.
2. When it crosses a tile centre, position snaps exactly to the centre and the
   decision logic runs.
3. For Pac-Man: if `pendingDir` is set and the neighbouring tile in that
   direction is open, adopt it. Otherwise continue if the tile ahead is open,
   else stop against the wall.
4. A `pendingDir` opposite to the current direction is applied immediately, mid
   corridor, without waiting for a tile centre.
5. `pendingDir` carries a timestamp and is discarded after 400 ms (the spec's
   pre-turn window) so a stale flick can't fire at a later junction.
6. Cornering: Pac-Man may begin the turn up to `CORNER_TOLERANCE` sub-units
   before the exact centre, moving diagonally for those few units. This is what
   makes tight turns feel snappy rather than sticky. Ghosts do not corner.

Ghosts run the same core loop but decide one tile *ahead*: at each tile centre a
ghost picks the exit (excluding a reversal, excluding up-turns at no-up tiles)
that minimises Euclidean distance to its target tile, breaking ties in
up → left → down → right order. Faithfully reproducing that tie-break order is
what makes ghost routes look "right" to anyone who knows the game.

---

## 4. Input architecture

```
Pointer/Key/Gamepad events
        │
        ▼
  InputSource(s)            ← DOM-facing; joystick, swipe, keyboard, gamepad
        │  emits DirectionIntent { dir, timestamp, source }
        ▼
  InputController           ← arbitration (most-recent-source-wins), latching
        │  exposes snapshot: { latchedDir, requestedAt }
        ▼
  step()                    ← consumes snapshot; decides legality
```

### 4.1 Event handling

- **Pointer Events only** (`pointerdown`/`move`/`up`/`cancel`), with
  `setPointerCapture` on the joystick so a drag that leaves the control zone
  keeps tracking. Avoids maintaining parallel touch and mouse paths.
- Handlers are attached to the control-zone element, not `window`, and are
  registered `{ passive: false }` so `preventDefault()` can suppress scrolling
  and native gestures.
- CSS does the heavy lifting for gesture suppression:
  `touch-action: none` on the game surface, `overscroll-behavior: none` on
  `html, body`, `user-select: none`, `-webkit-touch-callout: none`.
- **Handlers do no math beyond storing the raw pointer position.** Snapping and
  both dead zones (radial and angular) run once per simulation tick from the
  stored position. Touch events can fire far more often than 60 Hz on some
  devices; doing work per-event wastes CPU and produces inconsistent results.

### 4.2 Joystick module

```ts
class VirtualJoystick implements InputSource {
  private origin: Vec2 = ZERO;        // ring centre; a layout constant, re-measured on resize
  private point: Vec2 | null = null;  // current pointer position
  private latched: Direction = Direction.None;

  sample(): DirectionIntent | null {
    if (!this.point) return null;                    // released → keep latch
    const v = sub(this.point, this.origin);
    if (length(v) < DEAD_ZONE) return null;
    const next = snapToCardinal(v);                  // may be None
    if (next === Direction.None || next === this.latched) return null;
    this.latched = next;
    return { dir: next, timestamp: now, source: 'joystick' };
  }
}
```

`snapToCardinal` gives each direction a 45° arc centred on its axis and leaves
the 45° wedge around each diagonal owning nothing, per spec §3.2 — an ambiguous
push returns `None` and emits no intent, so there is nothing for a hysteresis
margin to damp. The joystick's *visual* knob position is read directly from
`point` (analogue, smooth) while the emitted direction is the quantised value —
the two are deliberately different.

The origin is fixed because the base is: `JoystickView` computes the ring's
centre with `restPosition` on every layout change and hands it over, which is
also what keeps `getBoundingClientRect` out of the pointer handlers (§4.4).

The joystick renders as **DOM elements with CSS transforms**, not on the canvas:
it is compositor-driven, costs zero canvas fill-rate, animates on the GPU, and
is trivially themeable. `will-change: transform` and translate-only updates keep
it off the main thread's paint path.

### 4.3 Latching and arbitration

- The latched direction persists after `pointerup` (spec §3.2) — Pac-Man keeps
  going. `pointercancel` is treated identically to `pointerup`.
- `InputController` keeps the last intent from each source and picks the most
  recent by timestamp, so plugging in a keyboard mid-game just works.
- On death and on level start, the controller is reset to `Direction.None`
  (pending resolution of open question 1 in the product spec).
- The controller can be driven by a recorded intent stream instead of DOM
  events; that is the entire test harness for gameplay (§9).

### 4.4 Latency budget

Touch to visible change, targeting ≤ 2 frames at p95:

| Stage | Cost |
| --- | --- |
| OS → browser touch dispatch | ~4–8 ms (not controllable) |
| Handler stores position | < 0.1 ms |
| Next sim tick reads it | ≤ 16.6 ms worst case |
| Render + composite | ≤ 8 ms |

The controllable part is keeping the handler trivial and never blocking the main
thread. No `setTimeout`-based logic, no synchronous layout reads
(`getBoundingClientRect`) inside handlers — the control zone's rect is cached on
resize.

---

## 5. Asset strategy

### 5.1 Graphics: procedural first, atlas for characters

- **Maze walls, pellets, power pellets, and text** are drawn **procedurally**
  with canvas paths from the tile map. No image assets, resolution-independent
  at any DPR, and re-skinning a level is a palette swap. The maze is drawn once
  per level, so the path cost is irrelevant.
- **Pac-Man and the ghosts** ship as a single **sprite atlas**: one WebP (with
  PNG fallback via `<picture>`-style feature detection) at 4× the base tile size,
  plus a small JSON frame map. Roughly 60 frames (Pac-Man 3 chomp phases × 4
  directions, 4 ghosts × 2 anim frames × 4 directions, frightened ×2, flashing
  ×2, eyes ×4, fruit ×8, score bubbles). Estimated ≤ 20 KB.
- Atlas is decoded via `createImageBitmap()` off the main thread before the
  first frame, so there is no decode hitch on level start.
- Fonts: the HUD uses a bitmap glyph strip in the same atlas rather than a
  webfont, avoiding an extra request, FOUT, and layout shift. Overlay/menu text
  uses a system font stack.

### 5.2 Audio: Web Audio + one sprite file

- A single **audio sprite** (all cues concatenated into one file) plus a JSON
  offset map. One request, one decode, sample-accurate playback via
  `AudioBufferSourceNode`. `<audio>` elements are unusable here: iOS limits
  concurrent instances and their playback latency is far too high for a chomp
  sound.
- Format: `.webm/opus` with an `.m4a/aac` fallback for older iOS. Total ≤ 60 KB.
- **Unlock:** the `AudioContext` is created on the first user gesture (the "TAP
  TO PLAY" target exists partly for this) and `resume()`d there; iOS Safari
  otherwise leaves it suspended.
- The siren is a set of looping buffers, cross-faded as pellet count crosses
  thresholds. Mute sets a gain node to 0 — it never stops the simulation clock or
  skips events.
- Audio subsystem is a pure consumer of `state.events` plus a small amount of
  derived state (pellet count for siren pitch, ghost modes for loop selection).

### 5.3 Delivery

- Everything is fingerprinted and served with `Cache-Control: immutable`, except
  `index.html` (short TTL) and the service worker (no-store).
- The atlas, audio sprite, and maze data are precached by the service worker at
  install so the second load is fully offline.
- No runtime asset requests during play; the `Ready` phase does not start until
  all assets have resolved.

---

## 6. Project structure

```
pacman/
├── docs/
│   ├── product-spec.md
│   └── technical-architecture.md
├── public/
│   ├── manifest.webmanifest
│   ├── icons/                    # PWA icons, 192/512/maskable
│   └── assets/
│       ├── sprites.webp  sprites.png  sprites.json
│       └── audio.webm    audio.m4a    audio.json
├── src/
│   ├── main.ts                   # bootstrap: load assets → mount → start loop
│   ├── app/
│   │   ├── loop.ts               # fixed-timestep driver, visibility handling
│   │   ├── layout.ts             # viewport math (product spec §2), resize observer
│   │   └── persistence.ts        # localStorage: high score, settings
│   ├── sim/                      # pure, DOM-free (see §3.4)
│   ├── render/
│   │   ├── viewport.ts           # tile↔pixel transforms, DPR handling
│   │   ├── maze-layer.ts         # one-shot procedural maze draw
│   │   ├── entity-layer.ts       # per-frame sprites, interpolation
│   │   ├── overlay-layer.ts      # READY!/GAME OVER/flash
│   │   └── atlas.ts              # frame lookup + drawing helpers
│   ├── input/
│   │   ├── controller.ts         # arbitration + latching
│   │   ├── joystick.ts           # static stick, dead zones, 4-way snapping
│   │   ├── joystick-view.ts      # DOM/CSS rendering of the stick
│   │   ├── swipe.ts  keyboard.ts  gamepad.ts
│   ├── audio/
│   │   ├── engine.ts             # context, unlock, sprite playback
│   │   └── director.ts           # events → cues, siren state
│   ├── ui/                       # DOM chrome: hud, pause, gameover, settings
│   └── data/
│       ├── maze-classic.ts       # tile map + pellet layout
│       └── levels.ts             # per-level tuning table
├── tests/
│   ├── sim/                      # unit tests: targeting, movement, scoring
│   └── replays/                  # recorded input streams + expected digests
├── index.html
├── vite.config.ts
└── package.json
```

The `sim/` directory has an enforced rule (lint boundary): it may not import
from `render/`, `input/`, `ui/`, `audio/`, or reference `window`/`document`. That
single constraint is what keeps the game testable and the loop honest.

---

## 7. Build and tooling

- **Vite** — dev server with HMR, Rollup production build, first-class TS. Build
  output is a handful of static files.
- **TypeScript strict mode**, including `noUncheckedIndexedAccess` (worth it for
  tile-array access).
- **Vitest** for unit and replay tests; **Playwright** for a smoke test that
  loads the page, drives synthetic pointer events, and asserts the score changes.
- **ESLint** with an import-boundary rule enforcing the `sim/` isolation.
- No transpilation below ES2020; every target browser supports it, and the
  smaller output matters more than ancient-browser reach.
- Bundle budget enforced in CI: fail the build if JS exceeds 120 KB gzipped or
  total initial payload exceeds 250 KB.

---

## 8. Deployment, PWA, and backend

### 8.1 Hosting

Pure static hosting — Cloudflare Pages, Netlify, Vercel, or GitHub Pages all
work identically. Deploy is "upload `dist/`". CI builds on push to `main` and
publishes; PRs get preview deployments.

Required headers: long-lived immutable caching for `/assets/*`, `no-store` for
`sw.js`, and HTTPS (mandatory for service workers and the Vibration API).

### 8.2 PWA

Genuinely valuable here, not box-ticking:

- **Offline play** via a service worker precaching the app shell and assets
  (Workbox generateSW, or ~40 hand-written lines — the asset list is static and
  small).
- **Add to Home Screen** with `display: "standalone"`, `orientation: "portrait"`,
  and a dark theme colour. Standalone mode removes browser chrome, which reclaims
  ~100 px of vertical space and is the only reliable way to get a fullscreen,
  chrome-free experience on iOS.
- **`requestFullscreen()`** on Android as a progressive enhancement, triggered by
  the play tap.
- **Screen Wake Lock API** during `Playing` so the screen doesn't dim mid-level;
  released on pause. Best-effort, feature-detected.
- Update strategy: the service worker installs new versions in the background
  and the app shows a non-blocking "new version — tap to reload" toast, applied
  only when not mid-game.

### 8.3 Backend

**None required for v1.** High score and settings live in `localStorage`.

Deliberately deferred, with the shape they would take:

- **Global leaderboard** — a single serverless function (`POST /score`) plus a
  KV store. Note that a client-authoritative score endpoint is trivially
  forgeable; doing this properly means submitting the recorded input replay and
  re-running the deterministic simulation server-side to validate the score.
  The integer-position, seeded-PRNG design in §3.2 is what makes that possible
  later — a good reason to keep the simulation pure even though nothing needs it
  today.
- **Analytics** — a privacy-preserving counter (levels reached, session length)
  via a lightweight endpoint or a cookieless provider. Requires a privacy notice.
- **Cloud save** — not worth an auth system for a single high-score integer.

### 8.4 Observability

Client-side only: a small error handler posting uncaught exceptions and
unhandled rejections to a Sentry-style endpoint (or a no-op in v1), plus an
opt-in FPS histogram reported at game over. Both must be disable-able and must
never run on the simulation's hot path.

---

## 9. Testing strategy

| Layer | Approach |
| --- | --- |
| Targeting rules | Unit tests per ghost: given a board state, assert the target tile. Cases taken from documented arcade behaviour, including Pinky's up-offset bug. |
| Movement | Table-driven tests for turn legality, cornering, tunnel wrap, no-up tiles. |
| Scoring / progression | Unit tests for multipliers, extra life, fruit timing, Elroy thresholds. |
| **Whole-game replays** | Record a stream of `(tick, DirectionIntent)` pairs, run the sim headless, assert a hash of the final state. Catches any accidental behaviour change in one cheap test. This is the payoff for a pure simulation. |
| Layout | Snapshot the computed `Viewport` for a matrix of viewport sizes and DPRs. |
| Input | Synthetic pointer sequences asserting emitted direction sequences, including radial dead-zone and angular dead-wedge edge cases. |
| Integration | Playwright smoke test on a mobile emulation profile. |
| Performance | Manual profiling on a low-end reference device per release; CI bundle-size gate. |

---

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| iOS Safari swallows or delays touch events near screen edges | Keep the control zone inset from edges; test on real hardware, not just the simulator |
| Address bar collapse changes viewport mid-game | Layout on the dynamic viewport; `ResizeObserver` triggers a pause-and-relayout, never a silent reflow |
| Audio stays suspended after a phone call / app switch | Re-check `context.state` on `visibilitychange` and resume on the next user gesture |
| Ghost AI "feels wrong" to players who know the original | Implement the documented quirks (tie-break order, no-up tiles, Pinky's offset) from the start; they are cheap to add and expensive to retrofit |
| Frame drops on low-end Android | Layered canvases and a static maze layer already remove most of the cost; dirty rects and a 30 Hz sim fallback are held in reserve |
| Turn-buffer window feels wrong | Expose it as a tunable constant plus a debug overlay showing buffered requests; settle it in playtesting |
| IP / trademark on "Pac-Man" | Original art and an original name before any public launch; mechanics are not the exposure |

---

## 11. Decision log

| Decision | Alternatives considered | Rationale |
| --- | --- | --- |
| Canvas 2D | WebGL, PixiJS, DOM, SVG | Draw load is trivial; smallest payload; no context-loss handling |
| No game framework | Phaser, Kaboom, Excalibur | Their loops and scene graphs would be fought, not used; 300 KB+ for features we don't need |
| Fixed 60 Hz timestep + interpolation | Variable delta | Tile-alignment logic is fragile under variable steps; determinism enables replay tests and future server validation |
| Integer sub-tile positions | Floats | Exact tile-centre tests; no drift; bit-identical replays |
| Joystick in DOM, game on canvas | Joystick on canvas | Compositor-driven, zero fill-rate cost, easier theming |
| Direction *intent* pipeline | Direct control from handlers | Makes all input sources and replay interchangeable; decouples event rate from tick rate |
| Events queue from sim | Direct calls to audio/UI | Keeps sim pure and headless-testable; muting can't affect gameplay |
| Sprite atlas for characters, procedural maze | All-sprite, all-procedural | Characters need arcade-faithful shapes; maze benefits from resolution independence and palette swaps |
| No backend | Serverless leaderboard now | Nothing in v1 needs it; a forgery-resistant leaderboard needs replay validation, which is designed for but deferred |
| PWA + service worker | Plain static site | Offline play, home-screen install, and fullscreen on iOS are real user wins for ~40 lines |

---

## 12. Suggested build order

1. **Skeleton** — Vite + TS project, canvas layers, layout math, fixed-step loop
   drawing a static maze. Verifies the hardest cross-cutting concern (responsive
   sizing) before any gameplay exists.
2. **Movement** — Pac-Man, grid-locked motion, turn buffering, tunnel. Playable
   with keyboard only.
3. **Joystick** — static stick, dead zone, 4-way snapping, latching. This is where
   the game either feels good or doesn't; budget playtesting time here.
4. **Pellets and scoring** — collection, HUD, level clear.
5. **Ghosts** — shared movement engine, then the four targeting rules, then
   scatter/chase scheduling, then the house release logic.
6. **Power pellets** — frightened mode, ghost eating, multipliers, eyes return.
7. **Lives and flow** — death, Ready/GameOver phases, level table, fruit, Elroy.
8. **Audio.**
9. **Polish** — PWA, wake lock, haptics, settings, accessibility options.
10. **Hardening** — replay tests, device testing matrix, performance pass.

Steps 1–3 are the risky ones; everything after is well-understood work.
