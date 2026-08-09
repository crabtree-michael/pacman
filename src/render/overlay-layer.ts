import { Phase, type GameState } from '../sim/types';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The overlay layer — the card for whatever phase the game is in.
 *
 * Redrawn only when what it shows changes, which for these cards is a handful
 * of times per level rather than 60 times a second (architecture §2.2).
 */

const TEXT_COLOR = '#ffcc00';
const HINT_COLOR = '#ffffff';
const DIM_COLOR = 'rgba(0, 0, 0, 0.6)';

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
  private cols = 0;
  private rows = 0;
  private lastKey = '';

  constructor(private readonly canvas: HTMLCanvasElement) {}

  resize(viewport: Viewport, cols: number, rows: number): void {
    this.context = prepareCanvas(this.canvas, viewport);
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

    // TODO(render): the arcade uses a bitmap glyph strip from the sprite atlas
    // (architecture §5.1). A system font is a stand-in until that art exists.
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const centreY = this.rows / 2 + 3.5;
    context.fillStyle = TEXT_COLOR;
    context.font = '1.6px ui-monospace, monospace';
    context.fillText(card.title, this.cols / 2, centreY);

    if (card.hint) {
      context.fillStyle = HINT_COLOR;
      context.font = '1px ui-monospace, monospace';
      context.fillText(card.hint, this.cols / 2, centreY + 2.2);
    }
  }
}

function cardFor(state: GameState): OverlayCard {
  switch (state.phase) {
    case Phase.Boot:
      return { key: 'boot', title: 'LOADING' };
    case Phase.Attract:
      // TODO(ui): the real attract screen is a title, a high score and a TAP TO
      // PLAY target over a demo of the maze (product spec §2.3).
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
