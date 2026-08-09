import type { MazeData } from '../data/maze-classic';
import type { MazeState } from './types';

export const Pellet = { None: 0, Normal: 1, Power: 2 } as const;
export type Pellet = (typeof Pellet)[keyof typeof Pellet];

/** Wrap a column through the side tunnel. */
export function wrapCol(maze: MazeData, col: number): number {
  return ((col % maze.cols) + maze.cols) % maze.cols;
}

function charAt(maze: MazeData, col: number, row: number): string {
  if (row < 0 || row >= maze.rows) return '#';
  return maze.tiles[row]?.[wrapCol(maze, col)] ?? '#';
}

export function isWall(maze: MazeData, col: number, row: number): boolean {
  const char = charAt(maze, col, row);
  return char === '#' || char === '-';
}

/** The ghost-house gate: solid to Pac-Man, passable to ghosts entering or leaving. */
export function isDoor(maze: MazeData, col: number, row: number): boolean {
  return charAt(maze, col, row) === '-';
}

export function isTunnelRow(maze: MazeData, row: number): boolean {
  return row === maze.tunnelRow;
}

/** True inside the side tunnel itself, where ghosts crawl (product spec §4.1). */
export function isTunnelTile(maze: MazeData, col: number, row: number): boolean {
  if (!isTunnelRow(maze, row)) return false;
  return col <= maze.tunnelLeft || col >= maze.tunnelRight;
}

/** One of the four tiles a ghost may not turn upward at (product spec §4.1). */
export function isNoUpTile(maze: MazeData, col: number, row: number): boolean {
  return maze.noUpTiles.some((tile) => tile.x === col && tile.y === row);
}

/**
 * True inside the ghost house — the room, not its door.
 *
 * The tunnel row runs straight through the house, so a column test alone would
 * call half the tunnel home.
 */
export function isInsideHouse(maze: MazeData, col: number, row: number): boolean {
  const { left, right, top, bottom } = maze.house;
  return col >= left && col <= right && row >= top && row <= bottom;
}

/** Build the mutable pellet bitmap from the static layout. */
export function createMazeState(data: MazeData): MazeState {
  const pellets = new Uint8Array(data.cols * data.rows);
  let remaining = 0;

  for (let row = 0; row < data.rows; row++) {
    for (let col = 0; col < data.cols; col++) {
      const char = data.tiles[row]?.[col];
      if (char === '.') {
        pellets[row * data.cols + col] = Pellet.Normal;
        remaining++;
      } else if (char === 'o') {
        pellets[row * data.cols + col] = Pellet.Power;
        remaining++;
      }
    }
  }

  return { data, pellets, remaining };
}

export function pelletAt(maze: MazeState, col: number, row: number): Pellet {
  if (row < 0 || row >= maze.data.rows) return Pellet.None;
  const index = row * maze.data.cols + wrapCol(maze.data, col);
  return (maze.pellets[index] ?? Pellet.None) as Pellet;
}

/**
 * Take the collectible on a tile, if there is one. Returns what was taken.
 *
 * The bitmap is copied before it is written, never mutated in place: `step`
 * hands the renderer the previous state alongside the new one, and a shared
 * array would retro-actively eat the pellet out of the frame being
 * interpolated from. The copy costs 868 bytes on the ~244 ticks a level that
 * change it, and nothing on the rest (architecture §2.4, `state.ts`).
 */
export function takePelletAt(maze: MazeState, col: number, row: number): Pellet {
  const pellet = pelletAt(maze, col, row);
  if (pellet === Pellet.None) return Pellet.None;

  maze.pellets = new Uint8Array(maze.pellets);
  maze.pellets[row * maze.data.cols + wrapCol(maze.data, col)] = Pellet.None;
  maze.remaining--;
  return pellet;
}
