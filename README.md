# Pac-Man

Pac-Man for mobile web. Portrait-first, touch-controlled, runs as a static
bundle in the browser — no app store, no backend.

This repository currently holds the **skeleton only**: build tooling, the game
loop, the rendering pipeline, input handling and the responsive layout are in
place and wired together. Gameplay is not — see [Status](#status).

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

The dev server binds to all interfaces, so you can open it on a phone at
`http://<your-machine-ip>:5173` — worth doing early and often, since the touch
controls and the viewport fit are the parts that cannot be judged on a desktop.

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Vite dev server with hot module replacement |
| `npm run build`     | Typecheck, then build to `dist/`            |
| `npm run preview`   | Serve the production build locally          |
| `npm run typecheck` | Typecheck only                              |

Arrow keys or WASD work on desktop; on a touchscreen you get the virtual
joystick.

## Stack

TypeScript, Vite, and a 2D canvas. No UI framework and no game engine: the
whole app is one canvas plus a couple of DOM elements, so a framework would add
payload and a render model we would immediately have to work around. Keeping
the bundle small matters more than usual here — the target is a phone on a
mobile connection.

## Layout

```
index.html            Shell: HUD, canvas stage, joystick zone
src/
  main.ts             Entry point — finds the elements, starts the game
  game/
    Game.ts           Owns state and wires the pieces together
    GameLoop.ts       Fixed-timestep loop on requestAnimationFrame
    constants.ts      Tuning values (speeds, tick rate, colours)
    types.ts          Direction/vector/tile types shared across modules
    entities/
      Actor.ts        Grid movement shared by Pac-Man and the ghosts
      Pacman.ts       The player
      Ghost.ts        Ghosts (rendered, not yet driven)
    maze/
      Maze.ts         The static board and its tile lookups
      layout.ts       Placeholder board data
  render/
    CanvasRenderer.ts Canvas sizing, DPR handling, all drawing
  input/
    InputManager.ts   Collapses every device into one requested direction
    Joystick.ts       Virtual thumb-stick for touch
    KeyboardInput.ts  Desktop steering, for development
  ui/
    Hud.ts            Score and lives (DOM, not canvas)
  styles/
    main.css          Responsive layout, safe-area insets, joystick styling
```

Three seams are worth preserving as gameplay goes in:

- **The loop knows nothing about the game.** It calls `update(dt)` at a fixed
  60 Hz and `render(alpha)` once per animation frame, so behaviour is identical
  on a 60 Hz phone and a 120 Hz one.
- **The renderer only reads.** It takes a scene and draws it. It also owns the
  tile-to-pixel scale, so game code works in tile units and never sees a screen
  size or a device pixel ratio.
- **Input arrives as intent.** Devices push "the player wants to go left" into
  `InputManager`; the game polls it once per tick. Adding a control scheme
  means adding an `InputSource`, and touches nothing else.

## Status

Working: build and dev tooling, the fixed-timestep loop, canvas fit and
scaling, grid-aligned movement, the virtual joystick, keyboard input, the HUD,
and the responsive portrait/landscape layout.

Not built yet, each marked with a `TODO(area)` comment where it belongs:

- `TODO(maze)` — the real arcade board, pellets, power pellets, side tunnels
- `TODO(mechanics)` — pellet collection, scoring, collisions, lives, levels,
  and movement polish (cornering, per-level speed tables)
- `TODO(ghosts)` — scatter/chase/frightened modes, targeting, house release
- `TODO(render)` — pre-rendered maze, interpolation, sprites

The placeholder board is a stand-in with the arcade's 28 x 31 dimensions, so
proportions are honest even though the walls are not. Ghosts sit inert on their
spawn tiles.

## Deployment

`render.yaml` describes the site as a Render static site: `npm run build`,
publish `dist/`. There is nothing to run server-side.
