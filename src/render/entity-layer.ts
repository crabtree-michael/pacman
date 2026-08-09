import { Pellet, pelletAt } from '../sim/maze';
import { isFrightFlashing } from '../sim/modes';
import {
  Direction,
  DIRECTION_DELTA,
  GhostMode,
  SUBTILE,
  type Actor,
  type FruitState,
  type GameState,
  type GhostState,
  type PacmanState,
} from '../sim/types';
import { FRUIT_COLORS } from './palette';
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

const FRIGHT_COLOR = '#2121ff';
const FRIGHT_FLASH_COLOR = '#f8f8f8';
/** The frightened face — dot eyes and a wavy mouth, on the blue body. */
const FRIGHT_FACE_COLOR = '#ffb897';
const EYE_WHITE = '#ffffff';
const PUPIL_COLOR = '#2121ff';

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
    if (current.fruit) drawFruit(context, current.fruit);
    for (const [index, ghost] of current.ghosts.entries()) {
      this.drawGhost(context, previous.ghosts[index] ?? ghost, ghost, alpha, current);
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
    // Floored, because a wedge of exactly zero is a zero-length arc, and a
    // zero-length arc draws nothing at all: Pac-Man blinked out of existence
    // for the one tick in sixteen where the mouth was fully shut, and stayed
    // gone if he happened to park against a wall on that frame.
    const halfMouth = Math.max(openness * 0.3 * Math.PI, 0.02);
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
   * arcade ghost silhouette needs real art. The three states it has to tell
   * apart are here already, because they are gameplay: a player has to know at
   * a glance whether a ghost can be eaten, is about to stop being edible, or is
   * a pair of eyes that cannot hurt them.
   */
  private drawGhost(
    context: CanvasRenderingContext2D,
    previous: GhostState,
    current: GhostState,
    alpha: number,
    state: GameState,
  ): void {
    const { x, y } = interpolate(previous, current, alpha, this.cols);
    const radius = 0.75;

    // Eaten ghosts are eyes only — no body to draw.
    if (current.mode === GhostMode.Eaten) {
      drawEyes(context, x, y, radius, current.dir);
      return;
    }

    const frightened = current.mode === GhostMode.Frightened;
    // Colour is never the only signal (product spec §3.4): a frightened ghost
    // also loses its eyes for dots and gains a wavy skirt, so the state reads
    // without colour vision, and it flashes before the mode expires.
    const flashing = frightened && isFrightFlashing(state);
    context.fillStyle = frightened
      ? flashing
        ? FRIGHT_FLASH_COLOR
        : FRIGHT_COLOR
      : (GHOST_COLORS[current.name] ?? '#ffffff');

    context.beginPath();
    context.arc(x, y - radius * 0.15, radius, Math.PI, 0);
    if (frightened) {
      appendWavyBase(context, x, y, radius);
    } else {
      context.lineTo(x + radius, y + radius * 0.7);
      context.lineTo(x - radius, y + radius * 0.7);
    }
    context.closePath();
    context.fill();

    if (frightened) {
      drawFrightFace(context, x, y, radius, flashing);
      return;
    }
    drawEyes(context, x, y, radius, current.dir);
  }
}

/** The zigzag hem that distinguishes a frightened ghost by shape. */
function appendWavyBase(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  const base = y + radius * 0.7;
  const peak = base - radius * 0.28;
  context.lineTo(x + radius, base);
  for (const offset of [0.66, 0.33, 0, -0.33, -0.66]) {
    context.lineTo(x + radius * (offset + 0.165), peak);
    context.lineTo(x + radius * offset, base);
  }
  context.lineTo(x - radius, base);
}

function drawFrightFace(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  flashing: boolean,
): void {
  context.fillStyle = flashing ? FRIGHT_COLOR : FRIGHT_FACE_COLOR;
  for (const sign of [-1, 1]) {
    context.beginPath();
    context.arc(x + sign * radius * 0.36, y - radius * 0.2, radius * 0.14, 0, Math.PI * 2);
    context.fill();
  }
}

/**
 * The eyes, looking the way the ghost is travelling. On an eaten ghost they
 * are the whole sprite.
 */
function drawEyes(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  dir: Direction,
): void {
  const look = DIRECTION_DELTA[dir];
  for (const sign of [-1, 1]) {
    const eyeX = x + sign * radius * 0.38;
    const eyeY = y - radius * 0.2;

    context.fillStyle = EYE_WHITE;
    context.beginPath();
    context.arc(eyeX, eyeY, radius * 0.26, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = PUPIL_COLOR;
    context.beginPath();
    context.arc(
      eyeX + look.x * radius * 0.11,
      eyeY + look.y * radius * 0.11,
      radius * 0.13,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

/**
 * The bonus fruit.
 *
 * TODO(render): eight distinct fruit shapes come from the atlas (architecture
 * §5.1). A coloured body and a stem is the stand-in; the colour is the one the
 * status strip uses for the same level, so the two read as the same object.
 */
function drawFruit(context: CanvasRenderingContext2D, fruit: FruitState): void {
  const x = fruit.col + 0.5;
  const y = fruit.row + 0.5;

  context.fillStyle = FRUIT_COLORS[fruit.kind];
  context.beginPath();
  context.arc(x, y + 0.12, 0.42, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#3fae4a';
  context.lineWidth = 0.1;
  context.beginPath();
  context.moveTo(x, y - 0.2);
  context.quadraticCurveTo(x + 0.22, y - 0.5, x + 0.42, y - 0.44);
  context.stroke();
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
