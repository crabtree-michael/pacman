# Pac-Man Mobile Web — Product Spec

**Status:** Draft for review
**Scope:** Functional/product definition only. No implementation details — see `technical-architecture.md` for the "how".
**Owner:** TBD

---

## 1. Summary

A single-player, touch-first Pac-Man clone that runs in a mobile browser with no install and no account. The player controls Pac-Man with an on-screen virtual joystick placed under the maze in the natural thumb zone. The game is faithful to the arcade original's mechanics (maze, pellets, power pellets, four ghosts with distinct personalities, scatter/chase cycles, level progression) but re-laid-out for a tall phone screen and re-tuned for touch input.

### Goals

- Load and be playable in under 3 seconds on a mid-tier phone over 4G.
- Feel responsive: movement changes direction on the frame after the thumb moves.
- Be playable one-handed in portrait, and gracefully usable in landscape.
- Work fully offline after first load; no backend required.

### Non-goals (this version)

- Multiplayer, accounts, cloud leaderboards, or any server-authoritative logic.
- Desktop-optimised UI (keyboard input is a convenience, not a supported target).
- Exact pixel-for-pixel arcade ROM reproduction or licensed assets.

### Success criteria

| Metric | Target |
| --- | --- |
| Time to interactive (mid-tier Android, 4G) | ≤ 3 s |
| Sustained frame rate during play | 60 fps, ≥ 95% of frames within budget |
| Touch-to-visible-response latency | ≤ 2 frames (≤ 33 ms) at p95 |
| Session completes without an unintended input (zoom, scroll, refresh) | ≥ 99% of sessions |
| Playable on screens from 320×568 to 1024×1366 CSS px | No clipping or unreachable controls |

---

## 2. Screen layout

### 2.1 Portrait (primary orientation)

The screen divides into three stacked bands inside the safe area:

```
┌─────────────────────────────┐  ← safe-area top inset
│  HUD BAR            ~48 px  │  1UP / SCORE / HI-SCORE, pause button
├─────────────────────────────┤
│                             │  surplus height, split evenly
│       MAZE VIEWPORT         │  fixed 28:31 tile aspect (0.903)
│       (28 × 31 tiles)       │  centred, both ways
│                             │  surplus height, split evenly
├─────────────────────────────┤
│  STATUS STRIP       ~36 px  │  remaining lives, level fruit icons
├─────────────────────────────┤
│                             │  180-240 px tall
│      CONTROL ZONE           │
│         ( ◉ )               │  joystick docked to the bottom
└─────────────────────────────┘  ← safe-area bottom inset
```

**Sizing rule.** The maze is the flexible element; everything else has a fixed
minimum. The maze is scaled to the largest size that satisfies both:

- `mazeWidth ≤ availableWidth`
- `mazeHeight ≤ availableHeight − hudHeight − statusHeight − controlZoneMin`

with `controlZoneMin = 180 px` in portrait. On very tall screens the maze stops
growing at `mazeWidth = 520 px`.

**Where the surplus goes.** Whatever height the maze does not want is offered to
the control zone first, up to `controlZoneMax = 240 px` — enough for the largest
ring the scale rule can produce plus its inset above and below. Anything past
that stays in the maze band, which centres the board in it, so the leftover
reads as equal margins above and below the maze rather than as a cavern under
it. Nothing is taken from the maze to pay for this: there is only ever a surplus
when the maze has been capped by width (or by `mazeMaxWidth`), so the space
being redistributed is space the maze could not have used.

**Control zone.** The whole band is a touch target, not just the joystick
graphic. The joystick renders docked against the bottom of the band and stays
there; a touch anywhere in the band is read as a drag from that fixed centre
(see §3.2). Nothing else in the band is interactive, so a stray thumb can never
hit a button. The bottom is the anchor rather than the middle because the band's
height varies with the screen while its bottom edge does not — centring in it
put the stick most of the way up a tall phone, well above where the thumb rests.

**Worked examples**

| Device (CSS px) | Maze size | Control zone | Margin above/below the maze |
| --- | --- | --- | --- |
| 360 × 640 (small Android) | 340 × 376 | 180 px (at the minimum) | 0 px |
| 390 × 844 (iPhone 14) | 390 × 432 | 240 px (at the maximum) | 44 px |
| 430 × 932 (iPhone Pro Max) | 430 × 476 | 240 px (at the maximum) | 56 px |
| 768 × 1024 (tablet) | 520 × 576 | 240 px, joystick pinned bottom-left | 52 px |

Each row is the sizing rule applied directly: the maze takes all the height left
over above the 180 px minimum, so a surplus only exists when the maze is capped
by width (or by `mazeMaxWidth`, as on the tablet). Short screens like the
360 × 640 land exactly on the minimum with nothing left to distribute.

On tablets (≥ 600 px wide) the joystick pins to the bottom-*left* rather than
being centred across the band, because the screen is wider than a thumb arc; a
right-handed toggle in settings mirrors it. Either way the placement is fixed
for the session, and either way it is against the bottom.

**Available space.** All of the above is measured inside the safe-area insets,
not against the raw viewport. The insets are reserved for the notch and the home
indicator, so the bands never get them; sizing against a height that includes
them overflows every band by exactly the inset.

### 2.2 Landscape (supported, secondary)

Three columns: joystick gutter (left), maze (centre), HUD/pause (right).

```
┌────────┬───────────────┬────────┐
│        │               │ SCORE  │
│  ( ◉ ) │     MAZE      │ LIVES  │
│        │               │ ⏸      │
└────────┴───────────────┴────────┘
```

The maze is sized to `availableHeight − 2 × 12 px` and the leftover width is
split into the two gutters (minimum 120 px each). If the leftover width is under
240 px total, the maze shrinks until the gutters fit — the controls always win
over maze size. Handedness toggle mirrors the columns.

### 2.3 Other screens

- **Attract / title** — game logo, animated demo of the maze behind it, a single
  large "TAP TO PLAY" target, sound toggle, high score. Serves as the required
  user gesture for unlocking audio.
- **Pause overlay** — dims the maze, offers Resume / Restart / Sound. Entered by
  the HUD pause button or automatically when the tab is backgrounded, a call
  arrives, or orientation changes.
- **Game over** — final score, high score (and "NEW BEST!" state), Play Again.
- **Level intermission** — brief "LEVEL n" card between mazes, skippable by tap.

### 2.4 Layout invariants

- No part of the game requires page scrolling; the document never scrolls.
- Pinch-zoom, double-tap-zoom, text selection, long-press callouts, and
  pull-to-refresh are suppressed inside the game surface.
- All interactive controls sit at least 16 px inside the safe-area insets, and
  every tappable target is ≥ 44 × 44 CSS px.
- Rotating the device pauses the game, re-lays out, and shows a "tap to resume"
  state rather than resuming into a moving Pac-Man.

---

## 3. Joystick interaction

The joystick is a **direction-intent device**, not an analogue speed control.
Pac-Man moves at a fixed speed; the joystick only ever answers "which of the
four directions does the player want next?"

### 3.1 Geometry

| Property | Value | Notes |
| --- | --- | --- |
| Base diameter | 128 px | Visual ring, 40% opacity at rest |
| Knob diameter | 56 px | Follows the thumb |
| Max drag radius | 48 px | Knob clamps at this distance from base centre |
| Dead zone | 12 px (25% of drag radius) | Inside this, direction intent is unchanged |
| Angular dead zone | 45° per diagonal | A drag this close to a boundary emits nothing |
| Re-centre threshold | 8 px | Below this on release, treated as a tap, not a drag |
| Hit area | Entire control zone | Not limited to the visible ring |

Sizes are in CSS px and scale by a factor of `clamp(0.85, screenWidth / 390, 1.25)`
so the control feels the same physical size on a small Android and a Pro Max.

### 3.2 Behaviour

**Static placement.** The base is fixed: it sits against the bottom of the
control zone, centred across it on a phone and pushed into the near corner on a
tablet (per §2.1), and never moves. In landscape it centres in the joystick
gutter instead, which is already a thumb-width column running the height of the
screen. On `pointerdown` anywhere in
the band it fades to full opacity, and on `pointerup` it fades back over 200 ms —
but its position is a layout constant, so the stick is always where the player
last saw it and muscle memory carries between grabs. The origin is the ring's
centre, not the touch point.

**Drag.** While the pointer is down, the knob tracks the pointer, clamped to the
48 px radius. The vector from base centre to pointer is the raw input. Because
the origin is fixed, a touch that lands away from the centre already carries a
direction — the band behaves like a d-pad whose ring is only the visible hint.

**Dead zone.** If the raw vector's magnitude is under 12 px, no new direction is
emitted and the previously latched direction persists. This prevents jitter when
the thumb rests near centre.

**4-way snapping with an angular dead zone.** The stick is strictly 4-way: the
only values it can emit are Up, Down, Left, Right, or nothing. Each direction
owns a **45° arc centred on its axis** (22.5° either side); the **45° wedge
straddling each diagonal belongs to no direction at all**. A drag inside a wedge
is too shallow to read as either neighbour, so it emits nothing and the latched
direction rides on unchanged, rather than being snapped to whichever neighbour
happens to be marginally closer. Acceptance arcs and dead wedges therefore split
the circle in half. This replaces the earlier 15% hysteresis margin: an
ambiguous push now resolves to "not asking for anything", which cannot flicker,
so no margin is needed.

**Direction latching (the key touch adaptation).** The emitted direction is
sticky: it survives the player lifting their thumb. Releasing the joystick does
**not** stop Pac-Man — he continues in the last direction until he hits a wall,
exactly as with an arcade joystick that has been let go mid-corridor. This is
essential on touch, where the thumb is frequently lifted and re-placed.

**Turn buffering.** The latched direction is a *request*, not an instant
turn. The game holds the request and applies it at the first moment it becomes
legal — either immediately (if the perpendicular corridor is open) or when
Pac-Man reaches the next intersection. The request expires after **400 ms** if it
never becomes legal, so an old flick doesn't cause a surprise turn three
junctions later. This "pre-turn" window is what makes cornering feel good; it is
the single most important tuning value in the control scheme.

**Reversal is always immediate.** Requesting the direction opposite to travel
turns Pac-Man on the spot, with no intersection required.

**Visual feedback.** The knob shows the *raw* thumb position (analogue, smooth)
while a small chevron on the ring shows the *latched* direction (quantised).
Players can therefore see the angle they are actually pushing against the
direction Pac-Man is actually taking, which is what makes a drag stuck in a dead
wedge legible: the knob has left centre but the chevron has not followed. The
knob ring tints briefly when a turn request is buffered and clears when it is
consumed.

**Haptics.** A 10 ms vibration on each direction change, where
`navigator.vibrate` is available. Off by default on iOS (unsupported) and
respects a settings toggle.

### 3.3 Alternative inputs

Supported as conveniences, sharing the same direction-request pipeline:

- **Swipe anywhere on the maze** — a flick of ≥ 24 px emits one direction
  request. Useful for players who dislike joysticks.
- **Arrow keys / WASD** — for desktop and keyboard-equipped tablets.
- **Gamepad D-pad** — via the Gamepad API, best-effort.

Only one input source is "active" at a time; the most recent one wins.

### 3.4 Accessibility

- A settings option enlarges the joystick by 1.5× and widens the dead zone.
- A left/right handedness toggle mirrors joystick placement in landscape and on
  tablets.
- Colour is never the sole signal for ghost state: frightened ghosts also change
  shape (wavy base, dot eyes) and flash before expiring.
- `prefers-reduced-motion` disables screen shake and the level-complete maze
  flash, replacing them with a static tint.

---

## 4. Game mechanics

### 4.1 The maze

- 28 × 31 tile grid. Tiles are the unit of all collision and pathfinding.
- 240 pellets and 4 power pellets, for 244 collectibles per maze.
- A side tunnel connects the left and right edges on the row through the ghost
  house; entities wrap through it, and ghosts move at reduced speed inside it.
- A ghost house in the centre where ghosts start and where eaten ghosts respawn.
- Ghosts may not turn upward at four specific tiles (the classic "no-up zones"),
  preserving the original's exploitable route quirks.

Level 1–N reuse the same maze layout with different palettes; a second layout is
a stretch goal and the data format must not assume a single maze.

### 4.2 Player movement

- Pac-Man is grid-locked: he always travels along tile centre-lines and may only
  change to a perpendicular direction at a tile centre where the target tile is
  open.
- Reversal (180°) is legal at any point along a corridor.
- Base speed is 80% of the reference speed at level 1, rising to 90% at levels
  2–4 and 100% from level 5 (see the speed table in the architecture doc's
  tuning appendix).
- Eating a pellet costs one frame of movement (the classic slight slowdown while
  chewing); the effect is retained because it changes ghost-escape maths.
- Pac-Man is slightly faster than the ghosts while a power pellet is active.

### 4.3 Ghosts

Four ghosts, each with a distinct targeting rule. All ghosts share the same
movement engine: at every tile centre they pick the exit that minimises the
straight-line distance to their current *target tile*, and they may never
reverse direction voluntarily.

| Ghost | Colour | Chase target |
| --- | --- | --- |
| Blinky | Red | Pac-Man's current tile |
| Pinky | Pink | 4 tiles ahead of Pac-Man (with the original's up-direction offset bug preserved) |
| Inky | Cyan | The vector from Blinky to 2 tiles ahead of Pac-Man, doubled |
| Clyde | Orange | Pac-Man's tile when more than 8 tiles away; his scatter corner when closer |

**Modes.**

- **Scatter** — each ghost targets its own corner, producing the familiar
  circling behaviour.
- **Chase** — targeting rules above.
- **Frightened** — entered when Pac-Man eats a power pellet. Ghosts reverse
  immediately, turn blue, slow down, and choose directions pseudo-randomly.
  Duration shrinks with level (6 s at level 1, 0 s from level 19); ghosts flash
  white for the final ~2 s as a warning.
- **Eaten** — an eaten ghost becomes a pair of eyes that travels at high speed
  back to the ghost house, then re-enters play in the current global mode.

**Mode timing.** A global timer alternates scatter and chase in a fixed
per-level schedule (level 1: 7 s scatter, 20 s chase, 7 s, 20 s, 5 s, 20 s, 5 s,
then chase forever). Every scatter↔chase transition forces all non-frightened
ghosts to reverse. Frightened time does not advance the global timer.

**Release from the house.** Ghosts leave on a dot counter (Blinky immediately,
Pinky at 0 dots, Inky at 30, Clyde at 60 on level 1), with a global timeout of
4 s (3 s from level 5) of no dots eaten as a fallback so play never stalls.

**Cruise Elroy.** Blinky speeds up and switches to permanent chase targeting
when the remaining pellet count drops below a per-level threshold, in two
escalating stages. This is what makes late levels tense and must be included.

### 4.4 Scoring

| Event | Points |
| --- | --- |
| Pellet | 10 |
| Power pellet | 50 |
| Ghost (1st / 2nd / 3rd / 4th in one power pellet) | 200 / 400 / 800 / 1600 |
| Bonus fruit | 100 → 5000 depending on level |

- The ghost multiplier resets when the power pellet expires or the level ends.
- A bonus fruit appears below the ghost house after 70 and again after 170
  pellets are eaten, and disappears after ~9.5 s.
- One extra life is awarded at 10,000 points, once per game.
- High score persists locally on the device and is shown in the HUD and on the
  game-over screen. It is the only persisted state besides settings.

### 4.5 Lives, win and lose

- The player starts with 3 lives; the HUD shows lives remaining as Pac-Man icons.
- Contact with a non-frightened, non-eaten ghost costs a life: the game freezes
  for ~1 s, plays the death animation, then restarts the level with all entities
  at their start positions and the maze's remaining pellets intact.
- Losing the last life ends the game and shows the game-over screen.
- **Level win** — clearing all 244 collectibles. The maze flashes, a short
  intermission card shows, and the next level starts with faster ghosts, a
  shorter frightened duration, and a new fruit.
- **Level progression** — speeds, frightened duration, Elroy thresholds, and
  fruit type are driven by a per-level table. From level 21 the table clamps to
  its hardest values and the game continues indefinitely; there is no "win the
  game" end state, matching the arcade.

### 4.6 Game flow states

`Boot → Attract → Ready (3 s countdown) → Playing → {Dying → Ready | LevelComplete → Ready | GameOver → Attract}`

Pause can be entered from `Playing` and returns to it. Backgrounding the tab
auto-pauses; returning shows the pause overlay rather than resuming
immediately.

### 4.7 Audio

- Looping siren whose pitch rises as pellets are eaten; separate frightened and
  eyes-returning loops.
- One-shots: chomp (alternating two tones), power pellet, ghost eaten, fruit
  eaten, extra life, death.
- Intro jingle on `Ready`.
- Audio is muted until the player's first tap (browser autoplay policy) and a
  persistent mute toggle is available in the HUD and title screen. Muting must
  not affect game timing.

---

## 5. Responsiveness expectations

| Requirement | Definition |
| --- | --- |
| Supported viewports | 320 × 568 up to 1024 × 1366 CSS px |
| Orientation | Portrait primary; landscape fully supported; layout recomputed on `resize`/`orientationchange` |
| Pixel density | 1× through 4×; rendering scales with `devicePixelRatio`, capped at 3× for fill-rate reasons |
| Safe areas | All content respects `env(safe-area-inset-*)`; nothing under notches, rounded corners, or home indicators |
| Dynamic browser chrome | Layout uses the dynamic viewport (`100dvh` semantics) so the address bar collapsing does not clip the control zone |
| Text | HUD text scales with the maze; no reliance on the user's default font size for layout |
| Fallback | Below 320 px wide, the game shows a "screen too small" message rather than rendering unplayably |
| Foldables | Treated as ordinary resizes; the game pauses and re-lays out on fold/unfold |

Re-layout must never lose game state: resizing mid-level pauses, rescales, and
resumes from the identical simulation state.

---

## 6. Performance expectations

| Aspect | Target | Floor (acceptable) |
| --- | --- | --- |
| Frame rate | 60 fps sustained | ≥ 50 fps on a 4-year-old mid-tier Android |
| Frame budget (sim + render) | ≤ 8 ms | ≤ 14 ms |
| Input latency (touch → visible change) | ≤ 1 frame typical | ≤ 2 frames at p95 |
| Cold load, 4G, mid-tier phone | ≤ 3 s to interactive | ≤ 5 s |
| Total transferred payload (initial) | ≤ 250 KB gzipped | ≤ 400 KB |
| Repeat load (cached) | Instant, fully offline | — |
| Memory | ≤ 60 MB | ≤ 100 MB |
| Battery | No busy-wait; loop suspends entirely when backgrounded | — |

**Feel requirements**, which matter more than the raw numbers:

- A direction request made *before* an intersection is honoured *at* the
  intersection — players should never feel they turned "too early".
- No dropped frames during the death animation, power-pellet transition, or
  level-complete flash; these are the moments players notice stutter.
- Simulation speed is independent of frame rate: a device dropping to 40 fps must
  play at the same game speed, not in slow motion.
- On high-refresh (90/120 Hz) screens the game may render at the panel rate but
  the simulation remains locked to its fixed step.

---

## 7. Open questions

1. Should the joystick's latched direction persist across a death/respawn, or
   reset to "no input"? (Recommendation: reset, to avoid instantly walking into a
   ghost on respawn.)
2. Is 400 ms the right turn-buffer window, or should it be distance-based
   (e.g. "within 1.5 tiles of an intersection")? Needs playtesting.
3. Do we ship a second maze layout in v1, or leave it as data-ready but unused?
4. Should a swipe on the maze be enabled by default, or opt-in via settings?
5. Licensing/branding: the shipped game needs original art and a non-infringing
   name; the spec assumes classic mechanics with distinct visual identity.
