import type { MazeData } from '../data/maze-classic';
import type { MazePalette } from './palette';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The maze layer — walls and the ghost-house gate.
 *
 * Drawn procedurally from the tile map (architecture §5.1) and only when the
 * level, the palette or the viewport changes, never per frame. Procedural is
 * what makes it resolution-independent at any DPR and makes a level re-skin a
 * palette swap rather than new art.
 *
 * The walls are the arcade's rounded outlines rather than solid blocks: every
 * wall region is stroked along the faces that meet open space, with a quarter
 * arc at each outside corner. Two things fall out of that for free — a corridor
 * between two blocks shows the two parallel lines the original has, and the
 * outer ring is a double line, because the board's own edge counts as open
 * space and so gets stroked from the outside as well as the inside.
 */

/** Distance from a tile's edge to the line drawn along it, in tiles. */
const INSET = 0.28;
/** Corner radius: the lines meet a quarter-turn about the tile centre. */
const CORNER = 0.5 - INSET;
/** Stroke width, in tiles. */
const LINE_WIDTH = 0.1;

export class MazeLayer {
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  draw(maze: MazeData, viewport: Viewport, palette: MazePalette): void {
    const context = prepareCanvas(this.canvas, viewport);
    clearTiles(context, maze.cols, maze.rows);

    context.strokeStyle = palette.wall;
    context.lineWidth = LINE_WIDTH;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    // One path for the whole maze: ~700 short subpaths and a single stroke,
    // which is why this layer costs nothing to redraw when the palette flashes.
    context.beginPath();
    for (let row = 0; row < maze.rows; row++) {
      for (let col = 0; col < maze.cols; col++) {
        if (!isSolid(maze, col, row)) continue;
        outlineTile(context, maze, col, row);
      }
    }
    context.stroke();

    context.fillStyle = palette.door;
    for (let row = 0; row < maze.rows; row++) {
      for (let col = 0; col < maze.cols; col++) {
        if (charAt(maze, col, row) !== '-') continue;
        context.fillRect(col, row + 0.45, 1, 0.12);
      }
    }
  }
}

/**
 * A wall tile, for drawing purposes.
 *
 * Deliberately not `sim/maze`'s `isWall`: that one wraps columns through the
 * tunnel and treats everything above and below the board as solid, both of
 * which are right for movement and wrong here. Off the board reads as open
 * space, which is what puts a line along the outside of the border ring.
 */
function isSolid(maze: MazeData, col: number, row: number): boolean {
  return charAt(maze, col, row) === '#';
}

function charAt(maze: MazeData, col: number, row: number): string {
  if (col < 0 || col >= maze.cols || row < 0 || row >= maze.rows) return ' ';
  return maze.tiles[row]?.[col] ?? ' ';
}

/**
 * Add one wall tile's contribution to the outline path.
 *
 * Each open-facing side gets a straight line, running to the tile's edge where
 * the wall continues into its neighbour and stopping at the tile's centre line
 * where it does not — because there the corner arc takes over. Adjacent tiles
 * therefore hand off to each other exactly, with no seams and no overdraw.
 */
function outlineTile(
  context: CanvasRenderingContext2D,
  maze: MazeData,
  col: number,
  row: number,
): void {
  const cx = col + 0.5;
  const cy = row + 0.5;

  const up = isSolid(maze, col, row - 1);
  const down = isSolid(maze, col, row + 1);
  const left = isSolid(maze, col - 1, row);
  const right = isSolid(maze, col + 1, row);

  if (!up) {
    const y = cy - CORNER;
    context.moveTo(left ? cx - 0.5 : cx, y);
    context.lineTo(right ? cx + 0.5 : cx, y);
  }
  if (!down) {
    const y = cy + CORNER;
    context.moveTo(left ? cx - 0.5 : cx, y);
    context.lineTo(right ? cx + 0.5 : cx, y);
  }
  if (!left) {
    const x = cx - CORNER;
    context.moveTo(x, up ? cy - 0.5 : cy);
    context.lineTo(x, down ? cy + 0.5 : cy);
  }
  if (!right) {
    const x = cx + CORNER;
    context.moveTo(x, up ? cy - 0.5 : cy);
    context.lineTo(x, down ? cy + 0.5 : cy);
  }

  // Outside corners: a quarter turn about the tile centre, which is exactly
  // where the two straight runs stopped.
  if (!up && !right) arc(context, cx, cy, -Math.PI / 2, 0);
  if (!right && !down) arc(context, cx, cy, 0, Math.PI / 2);
  if (!down && !left) arc(context, cx, cy, Math.PI / 2, Math.PI);
  if (!left && !up) arc(context, cx, cy, Math.PI, Math.PI * 1.5);
}

function arc(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  from: number,
  to: number,
): void {
  context.moveTo(cx + Math.cos(from) * CORNER, cy + Math.sin(from) * CORNER);
  context.arc(cx, cy, CORNER, from, to);
}
