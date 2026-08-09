import { COLORS, TILE_SIZE } from '../game/constants';
import type { Ghost } from '../game/entities/Ghost';
import type { Pacman } from '../game/entities/Pacman';
import type { Maze } from '../game/maze/Maze';

export interface Scene {
  maze: Maze;
  pacman: Pacman;
  ghosts: readonly Ghost[];
}

/** Canvas angle each direction faces, used to orient Pac-Man's mouth. */
const FACING_ANGLE = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
} as const;

/**
 * Draws the game to a 2D canvas.
 *
 * The canvas is sized to fit the board into whatever box its container gives
 * it, then the context is scaled so all drawing code works in *board pixels*
 * (one tile = TILE_SIZE). Nothing downstream needs to know the device pixel
 * ratio or the current screen size — that is the whole point of this class
 * owning the fit.
 *
 * TODO(render): pre-render the static maze to an offscreen canvas and blit it
 * instead of re-filling every wall tile each frame; sprite-based actors once
 * we have art.
 */
export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly boardPixelWidth: number;
  private readonly boardPixelHeight: number;

  /** Board pixels -> CSS pixels. */
  private scale = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    board: { cols: number; rows: number },
  ) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('2D canvas context unavailable');
    }
    this.context = context;
    this.boardPixelWidth = board.cols * TILE_SIZE;
    this.boardPixelHeight = board.rows * TILE_SIZE;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }

  /** Re-fit the canvas to its container. Safe to call as often as you like. */
  resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    this.scale = Math.min(width / this.boardPixelWidth, height / this.boardPixelHeight);

    const cssWidth = this.boardPixelWidth * this.scale;
    const cssHeight = this.boardPixelHeight * this.scale;
    const dpr = window.devicePixelRatio || 1;

    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);

    // Resizing the backing store resets the context, so re-apply everything.
    this.context.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    this.context.imageSmoothingEnabled = false;
  }

  render(scene: Scene): void {
    this.context.fillStyle = COLORS.background;
    this.context.fillRect(0, 0, this.boardPixelWidth, this.boardPixelHeight);

    this.drawMaze(scene.maze);
    for (const ghost of scene.ghosts) {
      this.drawGhost(ghost);
    }
    this.drawPacman(scene.pacman);
  }

  private drawMaze(maze: Maze): void {
    this.context.fillStyle = COLORS.wall;
    maze.forEachTile((col, row, kind) => {
      if (kind !== 'wall') return;
      this.context.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    });
  }

  private drawPacman(pacman: Pacman): void {
    const centreX = pacman.position.x * TILE_SIZE;
    const centreY = pacman.position.y * TILE_SIZE;
    const radius = TILE_SIZE * 0.8;

    // mouthPhase runs 0..1; fold it so the mouth opens and closes smoothly.
    const openness = Math.abs(pacman.mouthPhase * 2 - 1);
    const halfMouth = openness * 0.28 * Math.PI;
    const facing = FACING_ANGLE[pacman.direction];

    this.context.fillStyle = COLORS.pacman;
    this.context.beginPath();
    this.context.moveTo(centreX, centreY);
    this.context.arc(centreX, centreY, radius, facing + halfMouth, facing - halfMouth);
    this.context.closePath();
    this.context.fill();
  }

  private drawGhost(ghost: Ghost): void {
    const centreX = ghost.position.x * TILE_SIZE;
    const centreY = ghost.position.y * TILE_SIZE;
    const radius = TILE_SIZE * 0.8;

    this.context.fillStyle = ghost.color;
    this.context.beginPath();
    this.context.arc(centreX, centreY - radius * 0.15, radius, Math.PI, 0);
    this.context.lineTo(centreX + radius, centreY + radius * 0.7);
    this.context.lineTo(centreX - radius, centreY + radius * 0.7);
    this.context.closePath();
    this.context.fill();

    const eyeOffsetX = radius * 0.38;
    const eyeRadius = radius * 0.26;
    this.context.fillStyle = '#ffffff';
    for (const sign of [-1, 1]) {
      this.context.beginPath();
      this.context.arc(
        centreX + sign * eyeOffsetX,
        centreY - radius * 0.2,
        eyeRadius,
        0,
        Math.PI * 2,
      );
      this.context.fill();
    }
  }
}
