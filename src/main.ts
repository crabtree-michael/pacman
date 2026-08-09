import { applyLayout, computeLayout } from './app/layout';
import { GameLoop } from './app/loop';
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
import { createInitialState } from './sim/state';
import { step } from './sim/step';
import { Direction } from './sim/types';
import { Hud } from './ui/hud';
import './styles/main.css';

/**
 * Bootstrap: mount the layers, wire input, start the loop.
 *
 * This is the only module that touches all four subsystems. Everything below
 * it stays one-directional — sim knows nothing of render, render knows nothing
 * of input.
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
const input = new InputController()
  .use(joystick)
  .use(swipe)
  .use(new KeyboardInput())
  .use(new GamepadInput());

const haptics = new Haptics(settings.haptics);

const hud = new Hud(document);
let highScore = loadHighScore();

// `previous` and `current` are the two states the renderer interpolates
// between. `step` returns a new state each tick, so holding on to the old one
// costs nothing.
let current = createInitialState(MAZE_CLASSIC);
let previous = current;

function relayout(): void {
  // Measured on the app box, not the stage: the band maths subtracts the HUD,
  // status strip and control zone from the *whole* available height. Measuring
  // the stage would both double-count and create a feedback loop, since the
  // stage's size is an output of this calculation.
  const metrics = computeLayout(
    app.clientWidth || window.innerWidth,
    app.clientHeight || window.innerHeight,
    current.maze.data.cols,
    current.maze.data.rows,
  );
  applyLayout(app, metrics);
  renderer.resize(metrics.mazeWidth, metrics.mazeHeight, current);
  joystickView.resize({
    tablet: metrics.tablet,
    orientation: metrics.orientation,
    handedness: settings.handedness,
  });
}

const loop = new GameLoop({
  step(stepMs) {
    input.sample(performance.now());
    const snapshot = input.snapshot();
    haptics.observe(snapshot);

    previous = current;
    current = step(current, snapshot, stepMs);

    if (current.score > highScore) {
      highScore = current.score;
      saveHighScore(highScore);
    }
    // TODO(audio): drain `current.events` into the audio director here — the
    // simulation queues them precisely so nothing downstream can affect it.
  },
  render(alpha) {
    renderer.render(previous, current, alpha);
    // The ring tints while the simulation is holding a turn request and clears
    // when it consumes one, so `pendingDir` is read straight from state.
    joystickView.sync(current.pacman.pendingDir !== Direction.None);
    hud.update(current, highScore);
  },
  onSuspend() {
    // TODO(ui): show the pause overlay rather than resuming into a moving
    // Pac-Man (product spec §2.3).
    input.reset();
    haptics.reset();
  },
});

relayout();
new ResizeObserver(() => relayout()).observe(app);
window.addEventListener('orientationchange', relayout);

loop.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.destroy();
    // Tears down every registered source, the swipe surface included.
    input.destroy();
    joystickView.destroy();
  });
}
