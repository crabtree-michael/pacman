import type { MazeData } from '../data/maze-classic';
import { isDoor, isWall } from '../sim/maze';
import { clearTiles, prepareCanvas, type Viewport } from './viewport';

/**
 * The maze layer — walls and the ghost-house gate.
 *
 * Drawn procedurally from the tile map (architecture §5.1) and only when the
 * level or the viewport changes, never per frame. It is the most expensive
 * thing to draw and it never moves, so giving it its own canvas removes most
 * of the per-frame cost outright (§2.2).
 */

export const WALL_COLOR = '#2121de';
export const DOOR_COLOR = '#ffb8ff';

/** Wall thickness as a fraction of a tile. */
const WALL_INSET = 0.28;

export class MazeLayer {
  constructor(private readonly canvas: HTMLCanvasElement) {}

  draw(maze: MazeData, viewport: Viewport): void {
    const context = prepareCanvas(this.canvas, viewport);
    clearTiles(context, maze.cols, maze.rows);

    context.fillStyle = WALL_COLOR;
    for (let row = 0; row < maze.rows; row++) {
      for (let col = 0; col < maze.cols; col++) {
        if (!isWall(maze, col, row) || isDoor(maze, col, row)) continue;
        this.drawWallTile(context, maze, col, row);
      }
    }

    context.fillStyle = DOOR_COLOR;
    for (let row = 0; row < maze.rows; row++) {
      for (let col = 0; col < maze.cols; col++) {
        if (!isDoor(maze, col, row)) continue;
        context.fillRect(col, row + 0.45, 1, 0.12);
      }
    }
  }

  /**
   * Draw one wall tile, extended toward whichever neighbours are also walls.
   *
   * This is what turns a grid of squares into continuous corridor walls: each
   * tile draws a centred block and then bridges the gap to its wall
   * neighbours, so adjacent tiles join seamlessly without needing a
   * corner/edge tile atlas.
   *
   * TODO(render): the arcade uses rounded double-line walls. Replace this with
   * a path-based pass when art lands; the layer already redraws only on level
   * or viewport change, so the extra cost is free.
   */
  private drawWallTile(
    context: CanvasRenderingContext2D,
    maze: MazeData,
    col: number,
    row: number,
  ): void {
    const solid = (c: number, r: number): boolean => isWall(maze, c, r) && !isDoor(maze, c, r);

    const left = solid(col - 1, row);
    const right = solid(col + 1, row);
    const up = solid(col, row - 1);
    const down = solid(col, row + 1);

    const x = col + (left ? 0 : WALL_INSET);
    const width = 1 - (left ? 0 : WALL_INSET) - (right ? 0 : WALL_INSET);
    const y = row + (up ? 0 : WALL_INSET);
    const height = 1 - (up ? 0 : WALL_INSET) - (down ? 0 : WALL_INSET);

    context.fillRect(x, y, width, height);
  }
}
