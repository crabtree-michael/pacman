import type { GameState } from '../sim/types';
import { EntityLayer } from './entity-layer';
import { MazeLayer } from './maze-layer';
import { OverlayLayer } from './overlay-layer';
import { computeViewport, type Viewport } from './viewport';

export interface RendererCanvases {
  maze: HTMLCanvasElement;
  entities: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
}

/**
 * Owns the three stacked canvases and the viewport they share.
 *
 * The renderer only ever reads simulation state — it holds no game logic and
 * mutates nothing (architecture §1).
 */
export class Renderer {
  private readonly mazeLayer: MazeLayer;
  private readonly entityLayer: EntityLayer;
  private readonly overlayLayer: OverlayLayer;

  private viewport: Viewport | null = null;
  private mazeDrawnFor = '';

  constructor(canvases: RendererCanvases) {
    this.mazeLayer = new MazeLayer(canvases.maze);
    this.entityLayer = new EntityLayer(canvases.entities);
    this.overlayLayer = new OverlayLayer(canvases.overlay);
  }

  /** Re-fit every layer. Cheap enough to call on any layout change. */
  resize(cssWidth: number, cssHeight: number, state: GameState): void {
    const { cols, rows } = state.maze.data;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    this.viewport = computeViewport(
      cssWidth,
      cssHeight,
      cols,
      rows,
      window.devicePixelRatio,
    );
    this.entityLayer.resize(this.viewport, cols, rows);
    this.overlayLayer.resize(this.viewport, cols, rows);

    // Resizing resets the backing store, so the static layer must be redrawn.
    this.mazeDrawnFor = '';
    this.drawMazeIfNeeded(state);
  }

  render(previous: GameState, current: GameState, alpha: number): void {
    if (!this.viewport) return;
    this.drawMazeIfNeeded(current);
    this.entityLayer.draw(previous, current, alpha);
    this.overlayLayer.draw(current);
  }

  private drawMazeIfNeeded(state: GameState): void {
    if (!this.viewport) return;
    const key = `${state.maze.data.name}:${state.level}`;
    if (key === this.mazeDrawnFor) return;
    this.mazeDrawnFor = key;
    this.mazeLayer.draw(state.maze.data, this.viewport);
  }
}
