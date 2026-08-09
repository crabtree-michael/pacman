/**
 * Classic maze data — 28 x 31 tiles (product spec §4.1).
 *
 * The format is deliberately a plain data object rather than a hard-coded
 * module: the spec calls for a second layout as a stretch goal, so nothing may
 * assume there is only one maze.
 *
 * Legend:
 *   `#`  wall
 *   `.`  pellet
 *   `o`  power pellet
 *   ` `  open, no collectible
 *   `-`  ghost-house door (wall to Pac-Man, passable to ghosts)
 *
 * Row 14 is both the side tunnel row and the row through the ghost house, as
 * the spec requires. It is open at both edges; entities wrap horizontally.
 */

export interface MazeSpawn {
  /** Tile column. */
  x: number;
  /** Tile row. */
  y: number;
}

export interface MazeData {
  name: string;
  cols: number;
  rows: number;
  /** One string per row, each `cols` characters long. */
  tiles: readonly string[];
  spawns: {
    pacman: MazeSpawn;
    /** Blinky starts above the house; the other three start inside it. */
    blinky: MazeSpawn;
    pinky: MazeSpawn;
    inky: MazeSpawn;
    clyde: MazeSpawn;
    /** Where the bonus fruit appears — below the ghost house (spec §4.4). */
    fruit: MazeSpawn;
  };
  /** Row the side tunnel runs along. */
  tunnelRow: number;
  /**
   * Tiles where ghosts may not turn upward (product spec §4.1).
   *
   * TODO(ghosts): populate from a reference map before targeting lands. Left
   * empty rather than guessed — wrong tiles here are worse than absent ones,
   * because they silently change ghost routes in ways that look like AI bugs.
   */
  noUpTiles: readonly MazeSpawn[];
}

export const MAZE_CLASSIC: MazeData = {
  name: 'classic',
  cols: 28,
  rows: 31,
  tiles: [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '######.##### ## #####.######',
    '######.##          ##.######',
    '######.## ###--### ##.######',
    '######.## #      # ##.######',
    '      .   #      #   .      ',
    '######.## #      # ##.######',
    '######.## ######## ##.######',
    '######.##          ##.######',
    '######.## ######## ##.######',
    '######.## ######## ##.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '#.##########.##.##########.#',
    '#.##########.##.##########.#',
    '#..........................#',
    '############################',
  ],
  spawns: {
    // The arcade starts Pac-Man straddling the boundary between columns 13 and
    // 14. We start him on the centre of tile 13 instead, so every entity begins
    // on an exact tile centre and the movement code needs no half-tile case.
    // TODO(mechanics): revisit if playtesting shows the offset matters.
    pacman: { x: 13, y: 23 },
    blinky: { x: 13, y: 11 },
    pinky: { x: 13, y: 14 },
    inky: { x: 11, y: 14 },
    clyde: { x: 15, y: 14 },
    // The corridor immediately under the house, on the loop that rings it.
    // It carries no pellets, so the fruit never hides one.
    fruit: { x: 13, y: 17 },
  },
  tunnelRow: 14,
  noUpTiles: [],
};
