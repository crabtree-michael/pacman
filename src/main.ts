import { Game, type GameInput, type GameView } from './app/game';
import { applyLayout, computeLayout } from './app/layout';
import { loadHighScore, loadSettings, saveHighScore } from './app/persistence';
import { MAZE_CLASSIC } from './data/maze-classic';
import { InputController } from './input/controller';
import { GamepadInput } from './input/gamepad';
import { Haptics } from './input/haptics';
import { JoystickView } from './input/joystick-view';
import { KeyboardInput } from './input/keyboard';
import { VirtualJoystick } from './input/joystick';
import { SwipeInput } from './input/swipe';
import { Renderer } from './render/renderer';
import { Direction, Phase } from './sim/types';
import { Hud } from './ui/hud';
import './styles/main.css';

/**
 * Bootstrap: mount the layers, wire input, open the boot gate, start the loop.
 *
 * This is the only module that touches all four subsystems. Everything below
 * it stays one-directional — sim knows nothing of render, render knows nothing
 * of input — and the game's own flow lives in `sim/phases.ts`, not here.
 */

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected an element matching "${selector}" in index.html`);
  }
  return element;
}

const app = required<HTMLElement>('#app');
const controlZone = required<HTMLElement>('#control-zone');
const board = required<HTMLElement>('#board');
const pauseButton = required<HTMLButtonElement>('[data-action="pause"]');

const renderer = new Renderer({
  maze: required<HTMLCanvasElement>('#layer-maze'),
  entities: required<HTMLCanvasElement>('#layer-entities'),
  overlay: required<HTMLCanvasElement>('#layer-overlay'),
});

// TODO(ui): the settings screen that writes these back is unbuilt, so today
// this only reads. Everything downstream already honours a change.
const settings = loadSettings();
app.dataset['handedness'] = settings.handedness;

const joystick = new VirtualJoystick();
joystick.setAccessible(settings.largeJoystick);
const joystickView = new JoystickView(controlZone, joystick);

// Four sources, one pipeline. The controller cannot tell them apart, which is
// exactly why a recorded intent stream can stand in for all of them (§4.3).
const swipe = new SwipeInput(board);
swipe.setEnabled(settings.swipe);
const controller = new InputController()
  .use(joystick)
  .use(swipe)
  .use(new KeyboardInput())
  .use(new GamepadInput());

const haptics = new Haptics(settings.haptics);

/**
 * The controller, with haptics riding along.
 *
 * Haptics is a consumer of the pipeline rather than a part of it, so `Game` has
 * no business knowing it exists. Wrapping here puts the pulse on the per-tick
 * path — `snapshot()` is read once per tick — and, just as importantly, ties it
 * to the same `reset()`: `Game` clears the latch on pause and on every entry
 * into `Ready`, and a cleared latch is not a direction change to buzz about.
 */
const input: GameInput = {
  sample: (nowMs) => controller.sample(nowMs),
  snapshot: () => {
    const snapshot = controller.snapshot();
    haptics.observe(snapshot);
    return snapshot;
  },
  reset: () => {
    controller.reset();
    haptics.reset();
  },
};

const view: GameView = {
  render(previous, current, alpha) {
    renderer.render(previous, current, alpha);
    // The knob is analogue and driven by the pointer, not the simulation, so it
    // syncs with the frame rather than with the tick. The ring's tint is the
    // one part read from state: it shows while the simulation is holding a turn
    // request and clears when it consumes or expires one (product spec §3.2).
    joystickView.sync(current.pacman.pendingDir !== Direction.None);
  },
};

const game = new Game({
  maze: MAZE_CLASSIC,
  view,
  chrome: new Hud(document),
  input,
  highScore: { load: loadHighScore, save: saveHighScore },
});

function relayout(): void {
  // Measured on the app box, not the stage: the band maths subtracts the HUD,
  // status strip and control zone from the *whole* available height. Measuring
  // the stage would both double-count and create a feedback loop, since the
  // stage's size is an output of this calculation.
  const state = game.state;
  const metrics = computeLayout(
    app.clientWidth || window.innerWidth,
    app.clientHeight || window.innerHeight,
    state.maze.data.cols,
    state.maze.data.rows,
  );
  applyLayout(app, metrics);
  renderer.resize(metrics.mazeWidth, metrics.mazeHeight, state);
  joystickView.resize({
    tablet: metrics.tablet,
    orientation: metrics.orientation,
    handedness: settings.handedness,
  });
}

pauseButton.addEventListener('click', () => {
  if (game.isPaused) game.resume();
  else game.pause();
});

// Tap anywhere on the board to come back from a pause, or to start a game from
// the attract screen (product spec §2.3). The pause button is excluded: its own
// `pointerdown` would resume the game a moment before its `click` paused it
// again.
app.addEventListener('pointerdown', (event) => {
  if ((event.target as Element | null)?.closest('[data-action="pause"]')) return;
  if (game.isPaused) game.resume();
  else if (game.phase === Phase.Attract) game.startGame();
});

relayout();
new ResizeObserver(() => relayout()).observe(app);
window.addEventListener('orientationchange', () => {
  // Rotating pauses, re-lays out, and waits for a tap rather than resuming into
  // a moving Pac-Man (product spec §2.4).
  game.pause();
  relayout();
});

game.start();

/**
 * The boot gate (architecture §5.3): `Ready` must not start until everything it
 * draws with has resolved.
 *
 * TODO(assets): decode the sprite atlas and the audio sprite here. Nothing is
 * loaded today — the maze and characters are drawn procedurally — so the gate
 * opens on the first microtask, before the first frame is painted.
 */
async function loadAssets(): Promise<void> {}

void loadAssets().then(() => {
  game.assetsLoaded();
  // TODO(ui): the attract screen owns this gesture, along with the audio unlock
  // that comes with it (product spec §2.3). Until it exists the game starts
  // itself rather than sitting on an empty Attract phase.
  game.startGame();
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
    // Tears down every registered source, the swipe surface included.
    controller.destroy();
    joystickView.destroy();
  });
}
