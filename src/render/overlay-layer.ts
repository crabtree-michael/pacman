import { Phase, type GameState } from '../sim/types';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The overlay layer — READY!, GAME OVER, the level-complete flash.
 *
 * Redrawn only when what it shows changes, which for these cards is a handful
 * of times per level rather than 60 times a second (architecture §2.2).
 */

const TEXT_COLOR = '#ffcc00';

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

    const key = overlayKey(state);
    if (key === this.lastKey) return;
    this.lastKey = key;

    clearTiles(context, this.cols, this.rows);
    if (!key) return;

    // TODO(render): the arcade uses a bitmap glyph strip from the sprite atlas
    // (architecture §5.1). A system font is a stand-in until that art exists.
    context.fillStyle = TEXT_COLOR;
    context.font = '1.6px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(key, this.cols / 2, this.rows / 2 + 3.5);
  }
}

function overlayKey(state: GameState): string {
  switch (state.phase) {
    case Phase.Ready:
      return 'READY!';
    case Phase.GameOver:
      return 'GAME OVER';
    case Phase.Paused:
      return 'PAUSED';
    default:
      return '';
  }
}
