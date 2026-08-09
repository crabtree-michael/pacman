import { Phase, type GameState } from '../sim/types';
import type { Atlas } from './atlas';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The overlay layer — the card for whatever phase the game is in.
 *
 * Redrawn only when what it shows changes, which for these cards is a handful
 * of times per level rather than 60 times a second (architecture §2.2).
 *
 * Text comes from the atlas's bitmap glyph strip (§5.1): no webfont request, no
 * FOUT, and the card scales with the maze rather than with the reader's default
 * font size (product spec §5). Before the atlas has decoded there is exactly
 * one card to draw — the boot gate's own — and that one falls back to a system
 * font, because by definition the glyphs it would use have not arrived yet.
 */

const TITLE_COLOR = '#ffcc00';
const HINT_COLOR = '#ffffff';
const DIM_COLOR = 'rgba(0, 0, 0, 0.6)';

/** Glyph heights in tile units. */
const TITLE_HEIGHT = 1.5;
const HINT_HEIGHT = 0.85;

/** What a phase puts on screen. `key` doubles as the redraw cache key. */
interface OverlayCard {
  key: string;
  title: string;
  hint?: string;
  /** Dim the board behind the card (product spec §2.3). */
  dim?: boolean;
}

export class OverlayLayer {
  private context: CanvasRenderingContext2D | null = null;
  private atlas: Atlas | null = null;
  private cols = 0;
  private rows = 0;
  private lastKey = '';

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  setAtlas(atlas: Atlas): void {
    this.atlas = atlas;
    this.lastKey = ''; // The glyphs just arrived; redraw whatever is showing.
  }

  resize(viewport: Viewport, cols: number, rows: number): void {
    this.context = prepareCanvas(this.canvas, viewport, { smoothing: true });
    this.cols = cols;
    this.rows = rows;
    this.lastKey = ''; // Force a redraw: the transform just changed.
  }

  draw(state: GameState): void {
    const context = this.context;
    if (!context) return;

    const card = cardFor(state);
    if (card.key === this.lastKey) return;
    this.lastKey = card.key;

    clearTiles(context, this.cols, this.rows);
    if (!card.title) return;

    if (card.dim) {
      context.fillStyle = DIM_COLOR;
      context.fillRect(0, 0, this.cols, this.rows);
    }

    // Below the middle of the board, which is where the arcade puts READY! —
    // clear of the ghost house and of Pac-Man's start tile.
    const titleY = this.rows / 2 + 2.6;
    this.write(context, card.title, titleY, TITLE_HEIGHT, TITLE_COLOR);
    if (card.hint) {
      this.write(context, card.hint, titleY + TITLE_HEIGHT + 0.8, HINT_HEIGHT, HINT_COLOR);
    }
  }

  private write(
    context: CanvasRenderingContext2D,
    text: string,
    top: number,
    height: number,
    color: string,
  ): void {
    const atlas = this.atlas;
    if (atlas) {
      atlas.drawText(context, text, this.cols / 2, top, { height, color, align: 'center' });
      return;
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillStyle = color;
    context.font = `${height}px ui-monospace, monospace`;
    context.fillText(text, this.cols / 2, top);
  }
}

function cardFor(state: GameState): OverlayCard {
  switch (state.phase) {
    case Phase.Boot:
      return { key: 'boot', title: 'LOADING' };
    case Phase.Attract:
      return { key: 'attract', title: 'PAC-MAN', hint: 'TAP TO PLAY' };
    case Phase.Ready:
      return { key: 'ready', title: 'READY!' };
    case Phase.LevelComplete:
      // The card announces the maze about to start, not the one just cleared.
      return { key: `level:${state.level}`, title: `LEVEL ${state.level + 1}` };
    case Phase.GameOver:
      return { key: 'gameover', title: 'GAME OVER' };
    case Phase.Paused:
      return { key: 'paused', title: 'PAUSED', hint: 'TAP TO RESUME', dim: true };
    default:
      // Playing and Dying are the entity layer's business.
      return { key: '', title: '' };
  }
}
