import { Pellet, pelletAt } from '../sim/maze';
import { isFrightFlashing } from '../sim/modes';
import { DYING_MS } from '../sim/phases';
import {
  GhostMode,
  Phase,
  SUBTILE,
  type Actor,
  type FruitState,
  type GameState,
  type GhostState,
  type PacmanState,
} from '../sim/types';
import {
  Atlas,
  CHOMP_PHASES,
  DEATH_FRAMES,
  GHOST_PHASES,
  frameName,
} from './atlas';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The entity layer — everything that moves, redrawn every frame.
 *
 * Characters come from the sprite atlas (architecture §5.1); pellets stay
 * procedural, because they are two circle sizes and baking them into the maze
 * layer would force a full maze re-render on every pellet eaten (§2.2).
 *
 * Every animation cursor here is derived from a simulation tick count, never
 * from a frame count. A 120 Hz panel renders each tick twice, and a chomp or a
 * blink driven by frames would run at double speed on it (product spec §6).
 */

const PELLET_COLOR = '#ffb897';
/** The arcade's cyan for the score that appears over an eaten ghost. */
const BUBBLE_COLOR = '#00ffff';

/** Ticks per full chomp cycle: open, half, shut, half. */
const CHOMP_PERIOD = 16;
/** Ticks per ghost hem frame. */
const GHOST_ANIM_PERIOD = 8;
/** Ticks per blue/white alternation while a frightened ghost is expiring. */
const FLASH_PERIOD = 14;
/** Ticks per power-pellet blink phase. */
const BLINK_PERIOD = 16;

/** Pac-Man holds still this long before the death animation starts. */
const DEATH_HOLD_MS = 400;
/** Milliseconds each death frame is held for.  11 frames, then an empty board. */
const DEATH_FRAME_MS = 90;

const BUBBLE_HEIGHT = 0.9;

/** The score bubble over a ghost that was just eaten (product spec §4.4). */
interface ScoreBubble {
  x: number;
  y: number;
  points: number;
}

export class EntityLayer {
  private context: CanvasRenderingContext2D | null = null;
  private atlas: Atlas | null = null;
  private cols = 0;
  private rows = 0;

  private bubble: ScoreBubble | null = null;
  /** The state whose events have already been drained into `bubble`. */
  private lastDrained: GameState | null = null;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  setAtlas(atlas: Atlas): void {
    this.atlas = atlas;
  }

  resize(viewport: Viewport, cols: number, rows: number): void {
    // Smoothing on, unlike the other layers: the atlas stores frames at 4x the
    // tile size, so a sprite is nearly always drawn *smaller* than its source.
    // Bilinear downsampling of antialiased art is what keeps the characters
    // clean; nearest sampling would drop pixels and shimmer as they move.
    this.context = prepareCanvas(this.canvas, viewport, { smoothing: true });
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

    this.drainEvents(current);

    clearTiles(context, this.cols, this.rows);
    this.drawPellets(context, current);

    if (!this.atlas) return;

    if (current.fruit) this.drawFruit(context, current.fruit);

    // The arcade clears the board while Pac-Man dies; so does this, and it is
    // not only for looks — a ghost left standing on him reads as though the
    // death had not happened yet.
    if (current.phase !== Phase.Dying) {
      for (const [index, ghost] of current.ghosts.entries()) {
        this.drawGhost(context, previous.ghosts[index] ?? ghost, ghost, alpha, current);
      }
    }

    this.drawPacman(context, previous.pacman, current.pacman, alpha, current);
    this.drawBubble(context, current);
  }

  /**
   * Latch the score bubble from the simulation's event queue.
   *
   * The queue is per-tick and the renderer may draw the same state more than
   * once — twice on a 120 Hz panel — so events are drained once per *state*,
   * not once per frame.
   */
  private drainEvents(current: GameState): void {
    if (current !== this.lastDrained) {
      this.lastDrained = current;
      for (const event of current.events) {
        if (event.type !== 'GhostEaten') continue;
        const ghost = current.ghosts.find((candidate) => candidate.name === event.name);
        if (!ghost) continue;
        this.bubble = {
          x: ghost.x / SUBTILE,
          y: ghost.y / SUBTILE,
          points: event.points,
        };
      }
    }
    // The bubble lives exactly as long as the freeze it was made for, so it
    // needs no clock of its own and survives a pause without drifting.
    if (current.freezeMs <= 0) this.bubble = null;
  }

  /** All 244 collectibles as a single path — one fill call per frame. */
  private drawPellets(context: CanvasRenderingContext2D, state: GameState): void {
    const { data } = state.maze;
    // Blinky's cursor is the clock: he is the one actor that never stops while
    // the board is live, and it is a tick count, so the blink is the same
    // speed on a 60 and a 120 Hz screen.
    const powerVisible = Math.floor(state.ghosts[0].animTicks / BLINK_PERIOD) % 2 === 0;

    context.fillStyle = PELLET_COLOR;
    context.beginPath();

    for (let row = 0; row < data.rows; row++) {
      for (let col = 0; col < data.cols; col++) {
        const pellet = pelletAt(state.maze, col, row);
        if (pellet === Pellet.None) continue;
        if (pellet === Pellet.Power && !powerVisible) continue;
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
    state: GameState,
  ): void {
    const atlas = this.atlas;
    if (!atlas) return;

    if (state.phase === Phase.Dying) {
      const frame = deathFrame(state.phaseTimer);
      if (frame !== null) {
        atlas.draw(context, frameName.death(frame), current.x / SUBTILE, current.y / SUBTILE);
      }
      return;
    }

    const { x, y } = interpolate(previous, current, alpha, this.cols);
    atlas.draw(context, frameName.pacman(current.dir, chompPhase(current.animTicks)), x, y);
  }

  private drawGhost(
    context: CanvasRenderingContext2D,
    previous: GhostState,
    current: GhostState,
    alpha: number,
    state: GameState,
  ): void {
    const atlas = this.atlas;
    if (!atlas) return;

    const { x, y } = interpolate(previous, current, alpha, this.cols);
    const phase = Math.floor(current.animTicks / GHOST_ANIM_PERIOD) % GHOST_PHASES;

    // Eaten ghosts are eyes only — no body to draw.
    if (current.mode === GhostMode.Eaten) {
      atlas.draw(context, frameName.eyes(current.dir), x, y);
      return;
    }

    if (current.mode === GhostMode.Frightened) {
      // Colour is never the only signal (product spec §3.4): the frightened
      // frames also swap the eyes for dots and gain a wavy mouth, so the state
      // reads without colour vision. The white flash alternates rather than
      // holding, which is what makes it read as a warning.
      const flashing =
        isFrightFlashing(state) &&
        Math.floor(current.animTicks / FLASH_PERIOD) % 2 === 1;
      atlas.draw(context, frameName.fright(phase, flashing), x, y);
      return;
    }

    atlas.draw(context, frameName.ghost(current.name, phase), x, y);
    atlas.draw(context, frameName.eyes(current.dir), x, y);
  }

  private drawFruit(context: CanvasRenderingContext2D, fruit: FruitState): void {
    this.atlas?.draw(context, frameName.fruit(fruit.kind), fruit.col + 0.5, fruit.row + 0.5);
  }

  private drawBubble(context: CanvasRenderingContext2D, state: GameState): void {
    const bubble = this.bubble;
    if (!bubble || !this.atlas || state.freezeMs <= 0) return;
    this.atlas.drawText(context, String(bubble.points), bubble.x, bubble.y - BUBBLE_HEIGHT / 2, {
      height: BUBBLE_HEIGHT,
      color: BUBBLE_COLOR,
      align: 'center',
    });
  }
}

/** Which of the three chomp frames a tick cursor lands on. */
export function chompPhase(animTicks: number): number {
  const quarter = Math.floor((animTicks % CHOMP_PERIOD) / (CHOMP_PERIOD / 4));
  // Open, half, shut, half — a triangle, so the mouth closes and opens again
  // over one period rather than snapping back open.
  return [CHOMP_PHASES - 1, 1, 0, 1][quarter] ?? 0;
}

/**
 * Which death frame the `Dying` clock is on, or null once the animation has
 * finished and the board is empty.
 *
 * Driven by the phase timer rather than a counter of its own, so it is exact
 * under a pause and cannot drift from the 1600 ms the phase actually lasts.
 */
export function deathFrame(phaseTimer: number): number | null {
  const elapsed = DYING_MS - phaseTimer;
  if (elapsed < DEATH_HOLD_MS) return 0;
  const index = Math.floor((elapsed - DEATH_HOLD_MS) / DEATH_FRAME_MS);
  return index < DEATH_FRAMES ? index : null;
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
