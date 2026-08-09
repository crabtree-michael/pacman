import { fruitForLevel } from '../sim/levels';
import { FRUIT_COLORS } from '../render/palette';
import type { GameState } from '../sim/types';

/**
 * Score, high score, lives and the level's fruit (product spec §2.1, §4.5).
 *
 * DOM rather than canvas: text laid out by the browser stays crisp at any
 * density, is readable by assistive tech, and costs no canvas fill-rate
 * (architecture §1).
 */

/** How many levels' fruit the status strip shows, as on the arcade cabinet. */
const LEVEL_MARKERS = 7;

export class Hud {
  private readonly score: HTMLElement;
  private readonly highScore: HTMLElement;
  private readonly lives: HTMLElement;
  private readonly levels: HTMLElement;

  private lastScore = -1;
  private lastHighScore = -1;
  private lastLives = -1;
  private lastLevel = -1;

  constructor(root: ParentNode) {
    this.score = requireChild(root, '[data-hud="score"]');
    this.highScore = requireChild(root, '[data-hud="high-score"]');
    this.lives = requireChild(root, '[data-hud="lives"]');
    this.levels = requireChild(root, '[data-hud="levels"]');
  }

  /** Called once per frame; writes to the DOM only when a value changed. */
  update(state: GameState, highScore: number): void {
    if (state.score !== this.lastScore) {
      this.lastScore = state.score;
      this.score.textContent = formatScore(state.score);
    }
    if (highScore !== this.lastHighScore) {
      this.lastHighScore = highScore;
      this.highScore.textContent = formatScore(highScore);
    }
    if (state.lives !== this.lastLives) {
      this.lastLives = state.lives;
      this.renderLives(state.lives);
    }
    if (state.level !== this.lastLevel) {
      this.lastLevel = state.level;
      this.renderLevels(state.level);
    }
  }

  /**
   * One wedge per life in hand.
   *
   * Rebuilding the row is cheap because it only happens when a life is lost or
   * won — a handful of times a game, not a handful of times a second.
   */
  private renderLives(lives: number): void {
    const count = Math.max(0, lives);
    this.lives.replaceChildren(
      ...Array.from({ length: count }, () => {
        const icon = document.createElement('span');
        icon.className = 'status__life';
        return icon;
      }),
    );
    this.lives.setAttribute('aria-label', `${count} ${count === 1 ? 'life' : 'lives'} left`);
  }

  /**
   * The fruit of the last few levels, oldest first — the arcade's progress bar.
   *
   * The colours come from the same table the board draws the fruit with, so the
   * marker and the thing it stands for are recognisably the same object.
   */
  private renderLevels(level: number): void {
    const first = Math.max(1, level - LEVEL_MARKERS + 1);
    const markers: HTMLElement[] = [];

    for (let shown = first; shown <= level; shown++) {
      const { kind } = fruitForLevel(shown);
      const icon = document.createElement('span');
      icon.className = 'status__fruit';
      icon.style.setProperty('--fruit-color', FRUIT_COLORS[kind]);
      markers.push(icon);
    }

    this.levels.replaceChildren(...markers);
    this.levels.setAttribute('aria-label', `Level ${level}`);
  }
}

function requireChild(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Expected a HUD element matching ${selector}`);
  }
  return element;
}

function formatScore(score: number): string {
  return score.toString().padStart(2, '0');
}
