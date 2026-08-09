import { fruitForLevel } from '../sim/levels';
import { frameName, type Atlas } from '../render/atlas';
import { FRUIT_COLORS } from '../render/palette';
import { Direction, type GameState } from '../sim/types';

/**
 * Score, high score, lives and the level's fruit (product spec §2.1, §4.5).
 *
 * DOM rather than canvas: text laid out by the browser stays crisp at any
 * density, is readable by assistive tech, and costs no canvas fill-rate
 * (architecture §1).
 *
 * The two icon rows are the exception — they are pictures of game objects, not
 * text, so once the atlas has decoded they are drawn from it as CSS background
 * sprites rather than approximated in CSS. Until then, and if the atlas never
 * arrives, the shapes below stand in.
 */

/** How many levels' fruit the status strip shows, as on the arcade cabinet. */
const LEVEL_MARKERS = 7;

/** The frame a life marker shows: mouth open, facing right. */
const LIFE_FRAME = frameName.pacman(Direction.Right, 2);

export class Hud {
  private readonly score: HTMLElement;
  private readonly highScore: HTMLElement;
  private readonly lives: HTMLElement;
  private readonly levels: HTMLElement;

  private atlas: Atlas | null = null;

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

  /** Swap the CSS stand-ins for the real art (architecture §5.1). */
  setAtlas(atlas: Atlas): void {
    this.atlas = atlas;
    // Both rows are rebuilt from a cached value, so invalidate the cache
    // rather than reaching into the DOM to re-style what is already there.
    this.lastLives = -1;
    this.lastLevel = -1;
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
        this.paint(icon, LIFE_FRAME);
        return icon;
      }),
    );
    this.lives.setAttribute('aria-label', `${count} ${count === 1 ? 'life' : 'lives'} left`);
  }

  /**
   * The fruit of the last few levels, oldest first — the arcade's progress bar.
   *
   * The colours are the fallback the same table gives the board, so a marker
   * and the thing it stands for are recognisably the same object even before
   * the art lands.
   */
  private renderLevels(level: number): void {
    const first = Math.max(1, level - LEVEL_MARKERS + 1);
    const markers: HTMLElement[] = [];

    for (let shown = first; shown <= level; shown++) {
      const { kind } = fruitForLevel(shown);
      const icon = document.createElement('span');
      icon.className = 'status__fruit';
      icon.style.setProperty('--fruit-color', FRUIT_COLORS[kind]);
      this.paint(icon, frameName.fruit(kind));
      markers.push(icon);
    }

    this.levels.replaceChildren(...markers);
    this.levels.setAttribute('aria-label', `Level ${level}`);
  }

  /** Dress one marker in its atlas frame, if there is one to dress it in. */
  private paint(element: HTMLElement, frame: string): void {
    const style = this.atlas?.spriteStyle(frame);
    if (!style) return;
    element.classList.add('status__icon--art');
    element.style.backgroundImage = style.backgroundImage;
    element.style.backgroundSize = style.backgroundSize;
    element.style.backgroundPosition = style.backgroundPosition;
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
