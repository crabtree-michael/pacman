import type { GameState } from '../sim/types';

/**
 * Score, high score and lives.
 *
 * DOM rather than canvas: text laid out by the browser stays crisp at any
 * density, is readable by assistive tech, and costs no canvas fill-rate
 * (architecture §1).
 */
export class Hud {
  private readonly score: HTMLElement;
  private readonly highScore: HTMLElement;
  private readonly lives: HTMLElement;

  private lastScore = -1;
  private lastHighScore = -1;
  private lastLives = -1;

  constructor(root: ParentNode) {
    this.score = requireChild(root, '[data-hud="score"]');
    this.highScore = requireChild(root, '[data-hud="high-score"]');
    this.lives = requireChild(root, '[data-hud="lives"]');
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
      // TODO(ui): the spec shows lives as Pac-Man icons; swap in the sprite
      // once the atlas exists (product spec §4.5).
      this.lives.textContent = '●'.repeat(Math.max(0, state.lives));
    }
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
