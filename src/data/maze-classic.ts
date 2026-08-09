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

/**
 * The ghost house, in tiles.
 *
 * Ghosts are the only things that cross the door, and they cross it on a
 * scripted path rather than by the tile-by-tile rules the rest of the board
 * runs on: the interior is an open room, not a corridor grid. These four
 * numbers are what that script needs, and holding them here rather than in
 * `sim/` is what keeps a second layout free to put its house somewhere else.
 */
export interface MazeHouse {
  /**
   * The tile immediately above the door — outside the house. Ghosts emerge
   * here, and returning eyes aim for it.
   */
  door: MazeSpawn;
  /** Where returning eyes drop to before turning round and coming back out. */
  centre: MazeSpawn;
  /** Interior bounding box, inclusive. */
  left: number;
  right: number;
  top: number;
  bottom: number;
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
  /**
   * The corner each ghost circles in scatter mode (product spec §4.3).
   *
   * All four sit outside the walls, which is deliberate and is the arcade's own
   * trick: a target no ghost can ever reach is what turns "walk towards it"
   * into the endless loop around a corner block.
   */
  scatter: {
    blinky: MazeSpawn;
    pinky: MazeSpawn;
    inky: MazeSpawn;
    clyde: MazeSpawn;
  };
  house: MazeHouse;
  /** Row the side tunnel runs along. */
  tunnelRow: number;
  /**
   * Where the tunnel proper begins at each end of that row: ghosts are slowed
   * on columns at or left of `tunnelLeft` and at or right of `tunnelRight`
   * (product spec §4.1).
   *
   * Stated rather than derived. The tunnel row also runs through the ghost
   * house, so "the part of the row that is walled above and below" would catch
   * the two blind alleys beside the house as well.
   */
  tunnelLeft: number;
  tunnelRight: number;
  /** Tiles where ghosts may not turn upward (product spec §4.1). */
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
  // Three rows above the board and two below it, which is where the arcade's
  // are: its coordinates count from the top of the screen, and the maze starts
  // three rows down it. The gap is not cosmetic. Pulling these corners onto the
  // board changes real decisions — with the target on row 0 rather than row -3,
  // a scattering Blinky prefers the step down at (9, 14) to the step into the
  // tunnel by three units of squared distance, and spends the whole scatter
  // circling the ghost house instead of going to his corner.
  scatter: {
    blinky: { x: 25, y: -3 },
    pinky: { x: 2, y: -3 },
    inky: { x: 27, y: 32 },
    clyde: { x: 0, y: 32 },
  },
  house: {
    door: { x: 13, y: 11 },
    centre: { x: 13, y: 14 },
    left: 11,
    right: 16,
    top: 13,
    bottom: 15,
  },
  tunnelRow: 14,
  tunnelLeft: 5,
  tunnelRight: 22,
  // The two junctions above the ghost house and the two below it. These are the
  // arcade's, not a guess: they are what makes the corridor over the house a
  // one-way street for a chasing ghost, and the routes players learned to
  // exploit are exploits *of these four tiles*.
  noUpTiles: [
    { x: 12, y: 11 },
    { x: 15, y: 11 },
    { x: 12, y: 23 },
    { x: 15, y: 23 },
  ],
};
