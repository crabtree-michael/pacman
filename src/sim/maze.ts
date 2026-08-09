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
