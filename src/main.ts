import { Game } from './game/Game';
import './styles/main.css';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Expected an element with id "${id}" in index.html`);
  }
  return element as T;
}

const game = new Game({
  canvas: requireElement<HTMLCanvasElement>('game'),
  stage: requireElement('stage'),
  joystick: requireElement('joystick'),
  hud: requireElement('hud'),
});

game.start();

// Vite swaps modules in place during development; without this the old game
// keeps its loop and listeners running behind the new one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy());
}
