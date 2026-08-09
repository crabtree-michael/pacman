import type { TileKind } from '../types';
import { MAZE_COLS, MAZE_LAYOUT, MAZE_ROWS } from './layout';

/**
 * The static board: a fixed grid of wall/path tiles.
 *
 * Everything dynamic — pellets, fruit, the ghost-house door state — is
 * deliberately absent for now and will live alongside this class rather than
 * inside it.
 */
export class Maze {
  readonly cols: number;
  readonly rows: number;

  private readonly tiles: readonly TileKind[];

  constructor(layout: readonly string[] = MAZE_LAYOUT) {
    this.rows = layout.length;
    this.cols = layout[0]?.length ?? 0;

    const tiles: TileKind[] = [];
    for (const [rowIndex, row] of layout.entries()) {
      if (row.length !== this.cols) {
        throw new Error(
          `Maze row ${rowIndex} is ${row.length} tiles wide, expected ${this.cols}`,
        );
      }
      for (const char of row) {
        tiles.push(char === '#' ? 'wall' : 'path');
      }
    }
    this.tiles = tiles;
  }

  /**
   * Tiles outside the board read as walls. That keeps callers from having to
   * bounds-check every lookup.
   *
   * TODO(maze): the side tunnels wrap horizontally instead of being solid —
   * handle that here once the real layout marks them.
   */
  tileAt(col: number, row: number): TileKind {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return 'wall';
    }
    return this.tiles[row * this.cols + col] as TileKind;
  }

  isWall(col: number, row: number): boolean {
    return this.tileAt(col, row) === 'wall';
  }

  /** Walk every tile once, for rendering or for building derived structures. */
  forEachTile(visit: (col: number, row: number, kind: TileKind) => void): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        visit(col, row, this.tileAt(col, row));
      }
    }
  }
}

export { MAZE_COLS, MAZE_ROWS };
