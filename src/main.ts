import { Game, type GameInput, type GameView } from './app/game';
import { applyLayout, computeLayout } from './app/layout';
import { loadHighScore, loadSettings, saveHighScore, saveSettings } from './app/persistence';
import { attachStats } from './app/stats';
import { AudioDirector } from './audio/director';
import { AudioEngine } from './audio/engine';
import { MAZE_CLASSIC } from './data/maze-classic';
import { InputController } from './input/controller';
import { GamepadInput } from './input/gamepad';
import { Haptics } from './input/haptics';
import { JoystickView } from './input/joystick-view';
import { KeyboardInput } from './input/keyboard';
import { VirtualJoystick } from './input/joystick';
import { SwipeInput } from './input/swipe';
import { loadAtlas } from './render/atlas';
import { Renderer } from './render/renderer';
import { Direction, Phase } from './sim/types';
import { Hud } from './ui/hud';
import './styles/main.css';

/**
 * Bootstrap: mount the layers, wire input, open the boot gate, start the loop.
 *
 * This is the only module that touches all five subsystems. Everything below
 * it stays one-directional — sim knows nothing of render, render knows nothing
 * of input, audio knows nothing of anything — and the game's own flow lives in
 * `sim/phases.ts`, not here.
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
const soundButton = required<HTMLButtonElement>('[data-action="sound"]');
const newGameButton = required<HTMLButtonElement>('[data-action="new-game"]');
const bootError = required<HTMLElement>('#boot-error');

// Read once: the renderer's motion decisions are made per level, not per frame,
// and a player who changes the system setting mid-game gets it on reload.
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const renderer = new Renderer(
  {
    maze: required<HTMLCanvasElement>('#layer-maze'),
    entities: required<HTMLCanvasElement>('#layer-entities'),
    overlay: required<HTMLCanvasElement>('#layer-overlay'),
  },
  { reducedMotion },
);

// TODO(ui): the settings screen that writes the input options back is unbuilt,
// so today only the sound toggle round-trips. Everything downstream already
// honours a change to any of them.
const settings = loadSettings();
app.dataset['handedness'] = settings.handedness;

const joystick = new VirtualJoystick();
joystick.setAccessible(settings.largeJoystick);
const joystickView = new JoystickView(controlZone, joystick);

// Four sources, one pipeline. The controller cannot tell them apart, which is
// exactly why a recorded intent stream can stand in for all of them (§4.3).
const swipe = new SwipeInput(board);
swipe.setEnabled(settings.swipe);
// Held on to rather than constructed inline: the stick shows what the keyboard
// is holding, so the two are wired together below (product spec §3.3).
const keyboard = new KeyboardInput();
const controller = new InputController()
  .use(joystick)
  .use(swipe)
  .use(keyboard)
  .use(new GamepadInput());

const haptics = new Haptics(settings.haptics);

const audioEngine = new AudioEngine(!settings.sound);

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

/**
 * The phase, mirrored onto the app element.
 *
 * One attribute write per transition — a handful per level. It gives the CSS a
 * hook for anything that needs to know what screen the game is on, and it gives
 * the browser tests something to wait on that is not a canvas pixel diff.
 */
let mirroredPhase = '';

const view: GameView = {
  render(previous, current, alpha) {
    if (current.phase !== mirroredPhase) {
      mirroredPhase = current.phase;
      app.dataset['phase'] = current.phase;
    }
    renderer.render(previous, current, alpha);
    // The knob is analogue and driven by the pointer, not the simulation, so it
    // syncs with the frame rather than with the tick. The other two are read
    // from elsewhere: the chevron from the controller's latch, so the ring
    // shows what the game was asked for whichever source asked, and the tint
    // from the simulation, so it shows while a turn request is held and clears
    // when it is consumed or expires (product spec §3.2, §3.3).
    joystickView.sync({
      requested: controller.direction,
      held: keyboard.direction,
      buffered: current.pacman.pendingDir !== Direction.None,
    });
  },
};

const hud = new Hud(document);

const game = new Game({
  maze: MAZE_CLASSIC,
  view,
  chrome: hud,
  input,
  highScore: { load: loadHighScore, save: saveHighScore },
  audio: new AudioDirector(audioEngine),
});

/**
 * The space the bands actually get: the app box's *content* size.
 *
 * `clientWidth`/`clientHeight` include padding, and the app's padding is the
 * safe-area inset — 80-odd px of notch and home indicator on a modern handset.
 * Handing that to the band maths sized the maze for a screen taller than the
 * one its children were laid out in, so every band came out too big and the
 * bottom of the control zone was pushed off the screen by exactly the inset.
 * The insets are zero in a desktop browser and under Playwright's emulation,
 * which is why this only ever showed up on a real phone.
 */
function availableSize(): { width: number; height: number } {
  const style = getComputedStyle(app);
  const padding = (side: string): number =>
    Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;

  return {
    width: Math.max(0, (app.clientWidth || window.innerWidth) - padding('left') - padding('right')),
    height: Math.max(
      0,
      (app.clientHeight || window.innerHeight) - padding('top') - padding('bottom'),
    ),
  };
}

function relayout(): void {
  // Measured on the app box, not the stage: the band maths subtracts the HUD,
  // status strip and control zone from the *whole* available height. Measuring
  // the stage would both double-count and create a feedback loop, since the
  // stage's size is an output of this calculation.
  const state = game.state;
  const available = availableSize();
  const metrics = computeLayout(
    available.width,
    available.height,
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

function applySound(enabled: boolean): void {
  settings.sound = enabled;
  saveSettings(settings);
  audioEngine.setMuted(!enabled);
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.querySelector('[data-sound-on]')?.toggleAttribute('hidden', !enabled);
  soundButton.querySelector('[data-sound-off]')?.toggleAttribute('hidden', enabled);
}

applySound(settings.sound);
soundButton.hidden = !AudioEngine.isSupported;

pauseButton.addEventListener('click', () => {
  if (game.isPaused) game.resume();
  else game.pause();
});

soundButton.addEventListener('click', () => applySound(!settings.sound));

// The pause screen's New Game (product spec §2.3). `restart` only applies from
// `Paused` and `GameOver`, and the button is only on screen for the first of
// them, so the phase machine needs no help from here. The high score survives
// the game it abandons — `Game` has already banked it.
newGameButton.addEventListener('click', () => {
  game.restart();
});

// Tap anywhere on the board to come back from a pause, or to start a game from
// the attract screen (product spec §2.3). The HUD buttons are excluded: their
// own `pointerdown` would resume the game a moment before their `click` paused
// it again.
app.addEventListener('pointerdown', (event) => {
  // Every tap is a gesture the audio context can be unlocked from, including
  // the ones handled below and the ones ignored. iOS Safari will not start a
  // context outside one, and it can suspend an already-running context after a
  // call or an app switch (architecture §10).
  audioEngine.unlock();

  if ((event.target as Element | null)?.closest('button')) return;
  if (game.isPaused) game.resume();
  else if (game.phase === Phase.Attract) game.startGame();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audioEngine.resumeIfSuspended();
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

// `?stats` puts the frame budget on screen — the only way to check the spec's
// §6 numbers on the handset they are written about (see `app/stats.ts`).
if (new URLSearchParams(window.location.search).has('stats')) {
  attachStats(game.loop, app);
}

/**
 * The boot gate (architecture §5.3): `Ready` must not start until everything it
 * draws with has resolved.
 *
 * Only the sprite atlas is fetched. The maze is procedural and the audio sprite
 * is synthesised at the first gesture, so this is one request for the manifest
 * and one for the image, both decoded before the gate opens — and therefore
 * before a single sprite is asked for.
 */
async function loadAssets(): Promise<void> {
  const atlas = await loadAtlas();
  renderer.setAtlas(atlas);
  hud.setAtlas(atlas);
}

void loadAssets().then(
  () => {
    game.assetsLoaded();
    // The attract screen owns the first gesture from here: it is what unlocks
    // audio (architecture §5.2), so the game must not start itself.
  },
  (error: unknown) => {
    // The gate stays shut. Nothing on the board can be drawn without the atlas,
    // and a maze with invisible ghosts in it is worse than an honest message.
    console.error('Asset load failed', error);
    bootError.hidden = false;
  },
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.destroy();
    // Tears down every registered source, the swipe surface included.
    controller.destroy();
    joystickView.destroy();
    audioEngine.destroy();
  });
}
