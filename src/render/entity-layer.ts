import { Pellet, pelletAt } from '../sim/maze';
import {
  Direction,
  SUBTILE,
  type Actor,
  type GameState,
  type GhostState,
  type PacmanState,
} from '../sim/types';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The entity layer — everything that moves, redrawn every frame.
 *
 * Pellets live here rather than on the maze layer: they are cheap when batched
 * into one path, and baking them into the maze would force a full maze
 * re-render on every pellet eaten (architecture §2.2).
 */

const PACMAN_COLOR = '#ffcc00';
const PELLET_COLOR = '#ffb897';

const GHOST_COLORS: Readonly<Record<string, string>> = {
  blinky: '#ff0000',
  pinky: '#ffb8ff',
  inky: '#00ffff',
  clyde: '#ffb852',
};

/** Canvas angle each direction faces. */
const FACING: Readonly<Record<Direction, number>> = {
  [Direction.None]: 0,
  [Direction.Right]: 0,
  [Direction.Down]: Math.PI / 2,
  [Direction.Left]: Math.PI,
  [Direction.Up]: -Math.PI / 2,
};

/** Ticks per full chomp cycle. */
const CHOMP_PERIOD = 16;

export class EntityLayer {
  private context: CanvasRenderingContext2D | null = null;
  private cols = 0;
  private rows = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  resize(viewport: Viewport, cols: number, rows: number): void {
    this.context = prepareCanvas(this.canvas, viewport);
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Draw the frame between two simulation states.
   *
   * `alpha` is the leftover accumulator fraction; positions are interpolated,
   * discrete facts (a pellet being eaten) snap to `current` (architecture §2.4).
   */
  draw(previous: GameState, current: GameState, alpha: number): void {
    const context = this.context;
    if (!context) return;

    clearTiles(context, this.cols, this.rows);
    this.drawPellets(context, current);
    for (const [index, ghost] of current.ghosts.entries()) {
      this.drawGhost(context, previous.ghosts[index] ?? ghost, ghost, alpha);
    }
    this.drawPacman(context, previous.pacman, current.pacman, alpha);
  }

  /** All 244 collectibles as a single path — one fill call per frame. */
  private drawPellets(context: CanvasRenderingContext2D, state: GameState): void {
    const { data } = state.maze;
    context.fillStyle = PELLET_COLOR;
    context.beginPath();

    for (let row = 0; row < data.rows; row++) {
      for (let col = 0; col < data.cols; col++) {
        const pellet = pelletAt(state.maze, col, row);
        if (pellet === Pellet.None) continue;
        const radius = pellet === Pellet.Power ? 0.28 : 0.09;
        context.moveTo(col + 0.5 + radius, row + 0.5);
        context.arc(col + 0.5, row + 0.5, radius, 0, Math.PI * 2);
      }
    }

    context.fill();
  }

  private drawPacman(
    context: CanvasRenderingContext2D,
    previous: PacmanState,
    current: PacmanState,
    alpha: number,
  ): void {
    const { x, y } = interpolate(previous, current, alpha, this.cols);
    const radius = 0.75;

    // Chomp from the animation cursor, so the mouth is frame-rate independent.
    const phase = (current.animTicks % CHOMP_PERIOD) / CHOMP_PERIOD;
    const openness = Math.abs(phase * 2 - 1);
    const halfMouth = openness * 0.3 * Math.PI;
    const facing = FACING[current.dir];

    context.fillStyle = PACMAN_COLOR;
    context.beginPath();
    context.moveTo(x, y);
    context.arc(x, y, radius, facing + halfMouth, facing - halfMouth);
    context.closePath();
    context.fill();
  }

  /**
   * TODO(render): replace with the sprite atlas (architecture §5.1) — the
   * arcade ghost silhouette and its frightened/eyes states need real art, and
   * the spec requires frightened ghosts to differ in shape, not just colour.
   */
  private drawGhost(
    context: CanvasRenderingContext2D,
    previous: GhostState,
    current: GhostState,
    alpha: number,
  ): void {
    const { x, y } = interpolate(previous, current, alpha, this.cols);
    const radius = 0.75;

    context.fillStyle = GHOST_COLORS[current.name] ?? '#ffffff';
    context.beginPath();
    context.arc(x, y - radius * 0.15, radius, Math.PI, 0);
    context.lineTo(x + radius, y + radius * 0.7);
    context.lineTo(x - radius, y + radius * 0.7);
    context.closePath();
    context.fill();

    context.fillStyle = '#ffffff';
    for (const sign of [-1, 1]) {
      context.beginPath();
      context.arc(x + sign * radius * 0.38, y - radius * 0.2, radius * 0.26, 0, Math.PI * 2);
      context.fill();
    }
  }
}

/**
 * Interpolate an actor's position, in tile units.
 *
 * A tunnel wrap moves the actor most of a board width in one tick; blending
 * across that would fling it back through the maze, so wraps snap instead.
 */
function interpolate(
  previous: Actor,
  current: Actor,
  alpha: number,
  cols: number,
): { x: number; y: number } {
  const wrapped = Math.abs(current.x - previous.x) > (cols * SUBTILE) / 2;
  const x = wrapped ? current.x : previous.x + (current.x - previous.x) * alpha;
  const y = previous.y + (current.y - previous.y) * alpha;
  return { x: x / SUBTILE, y: y / SUBTILE };
}
