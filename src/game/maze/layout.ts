/**
 * PLACEHOLDER maze layout.
 *
 * Shape and dimensions match the arcade board (28 x 31 tiles) so the renderer,
 * viewport scaling and input can be built against realistic proportions, but
 * the wall arrangement itself is a stand-in. The real board — along with
 * pellets, power pellets, the ghost-house door and the side tunnels — lands
 * with the maze ticket. Note the ghost house here is a sealed box: there is no
 * door tile yet, and ghosts do not move regardless.
 *
 * The board is left-right symmetric, so only the left half is written out and
 * `mirror()` reflects it. That halves the surface area for typos and keeps the
 * symmetry structural rather than something to hand-maintain.
 *
 * Legend: '#' wall, ' ' path.
 */

const HALF_WIDTH = 14;

/** Left half of each row, top to bottom. Every string must be HALF_WIDTH long. */
const LEFT_HALF: readonly string[] = [
  '##############',
  '#             ',
  '# #### ##### #',
  '# #### ##### #',
  '#             ',
  '# ## ####### #',
  '#    ##      #',
  '#### ##### ###',
  '#### ##### ###',
  '#### ##      #',
  '#### ## ######',
  '        #     ',
  '#### ## #     ',
  '#### ## ######',
  '#### ##      #',
  '#### ##### ###',
  '#### ##### ###',
  '#             ',
  '# #### ##### #',
  '# #### ##### #',
  '#   ##       #',
  '### ## ##### #',
  '### ## ##### #',
  '#      ##    #',
  '# ######## ###',
  '# ######## ###',
  '#            #',
  '# ########## #',
  '# ########## #',
  '#             ',
  '##############',
];

function mirror(half: readonly string[]): string[] {
  return half.map((row, index) => {
    if (row.length !== HALF_WIDTH) {
      throw new Error(
        `Maze layout row ${index} is ${row.length} chars, expected ${HALF_WIDTH}`,
      );
    }
    return row + [...row].reverse().join('');
  });
}

export const MAZE_LAYOUT: readonly string[] = mirror(LEFT_HALF);

export const MAZE_COLS = HALF_WIDTH * 2;
export const MAZE_ROWS = MAZE_LAYOUT.length;

/** Placeholder spawn tiles, all on open path in the layout above. */
export const PACMAN_SPAWN_TILE = { x: 13, y: 29 } as const;
export const GHOST_SPAWN_TILES = [
  { x: 12, y: 11 },
  { x: 13, y: 11 },
  { x: 14, y: 11 },
  { x: 15, y: 11 },
] as const;
