import { LEVEL_COMPLETE_MS } from '../sim/phases';
import { Phase, type GameState } from '../sim/types';
import type { Atlas } from './atlas';
import { EntityLayer } from './entity-layer';
import { MazeLayer } from './maze-layer';
import { OverlayLayer } from './overlay-layer';
import { MAZE_FLASH, paletteForLevel, type MazePalette } from './palette';
import { computeViewport, type Viewport } from './viewport';

export interface RendererCanvases {
  maze: HTMLCanvasElement;
  entities: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
}

export interface RendererOptions {
  /**
   * Whether the player has asked for less motion (product spec §3.4).
   *
   * Passed in rather than read here so the media query lives with the rest of
   * the app's platform plumbing, and so tests can set it.
   */
  reducedMotion?: boolean;
}

/** Milliseconds per half-cycle of the cleared-board flash. */
const FLASH_PERIOD_MS = 250;

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
  private readonly reducedMotion: boolean;

  private viewport: Viewport | null = null;
  private mazeDrawnFor = '';

  constructor(canvases: RendererCanvases, options: RendererOptions = {}) {
    this.mazeLayer = new MazeLayer(canvases.maze);
    this.entityLayer = new EntityLayer(canvases.entities);
    this.overlayLayer = new OverlayLayer(canvases.overlay);
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /** Hand the decoded atlas to the layers that draw from it (§5.3). */
  setAtlas(atlas: Atlas): void {
    this.entityLayer.setAtlas(atlas);
    this.overlayLayer.setAtlas(atlas);
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
    const palette = this.paletteFor(state);
    const key = `${state.maze.data.name}:${state.level}:${palette.wall}`;
    if (key === this.mazeDrawnFor) return;
    this.mazeDrawnFor = key;
    this.mazeLayer.draw(state.maze.data, this.viewport, palette);
  }

  /**
   * The maze's colours, including the flash on a cleared board (spec §4.5).
   *
   * The flash is derived from the phase clock rather than counted in frames, so
   * it runs at the same speed on a 120 Hz panel and cannot drift from the two
   * seconds the phase actually lasts. Under `prefers-reduced-motion` it becomes
   * the static tint the spec asks for (§3.4) — the board still says "cleared",
   * it just stops strobing.
   */
  private paletteFor(state: GameState): MazePalette {
    if (state.phase !== Phase.LevelComplete) return paletteForLevel(state.level);
    if (this.reducedMotion) return MAZE_FLASH;

    const elapsed = LEVEL_COMPLETE_MS - state.phaseTimer;
    const bright = Math.floor(elapsed / FLASH_PERIOD_MS) % 2 === 1;
    return bright ? MAZE_FLASH : paletteForLevel(state.level);
  }
}
