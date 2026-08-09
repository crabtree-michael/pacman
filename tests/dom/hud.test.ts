import { beforeEach, describe, expect, it } from 'vitest';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { createInitialState } from '../../src/sim/state';
import { Hud } from '../../src/ui/hud';
import type { GameState } from '../../src/sim/types';

/**
 * The jsdom half of the harness (architecture §9).
 *
 * `ui/` and the DOM-facing parts of `input/` are not worth a browser to test,
 * but they do need a document. Anything that needs real layout, canvas or
 * pointer behaviour belongs in the Playwright smoke test instead.
 */

function mountHud(): HTMLElement {
  document.body.innerHTML = `
    <div data-hud-root>
      <span data-hud="score">00</span>
      <span data-hud="high-score">00</span>
      <span data-hud="lives"></span>
      <span data-hud="levels"></span>
    </div>
  `;
  return document.body;
}

function stateWith(overrides: Partial<GameState>): GameState {
  return { ...createInitialState(MAZE_CLASSIC), ...overrides };
}

function count(selector: string): number {
  return document.querySelectorAll(selector).length;
}

describe('Hud', () => {
  beforeEach(() => {
    mountHud();
  });

  it('renders score, high score and lives', () => {
    new Hud(document).update(stateWith({ score: 1230, lives: 2 }), 4560);

    expect(document.querySelector('[data-hud="score"]')?.textContent).toBe('1230');
    expect(document.querySelector('[data-hud="high-score"]')?.textContent).toBe('4560');
    expect(count('[data-hud="lives"] .status__life')).toBe(2);
  });

  it('writes to the DOM only when a value changed', () => {
    const hud = new Hud(document);
    const score = document.querySelector<HTMLElement>('[data-hud="score"]')!;

    hud.update(stateWith({ score: 10 }), 0);
    score.textContent = 'sentinel';
    hud.update(stateWith({ score: 10 }), 0);

    // Untouched: the HUD skipped the write because nothing moved.
    expect(score.textContent).toBe('sentinel');
  });

  it('handles a game over with no lives left', () => {
    new Hud(document).update(stateWith({ lives: 0 }), 0);
    expect(count('[data-hud="lives"] .status__life')).toBe(0);
  });

  it("marks the level's fruit, capped at the cabinet's seven", () => {
    const hud = new Hud(document);

    hud.update(stateWith({ level: 1 }), 0);
    expect(count('[data-hud="levels"] .status__fruit')).toBe(1);
    // Level 1 is the cherry, and the board draws it in the same colour.
    expect(
      document
        .querySelector<HTMLElement>('[data-hud="levels"] .status__fruit')
        ?.style.getPropertyValue('--fruit-color'),
    ).toBe('#ff2b2b');

    hud.update(stateWith({ level: 4 }), 0);
    expect(count('[data-hud="levels"] .status__fruit')).toBe(4);

    hud.update(stateWith({ level: 12 }), 0);
    expect(count('[data-hud="levels"] .status__fruit')).toBe(7);
  });

  it('fails loudly if the markup it needs is missing', () => {
    document.body.innerHTML = '<div></div>';
    expect(() => new Hud(document)).toThrow(/data-hud/);
  });
});
