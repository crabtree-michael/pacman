export interface Vec2 {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Unit vector per direction, in maze-tile space (+y is down). */
export const DIRECTION_VECTORS: Readonly<Record<Direction, Readonly<Vec2>>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** A tile as it appears in the maze layout. */
export type TileKind = 'wall' | 'path';

/** Anything the loop advances every tick. */
export interface Updatable {
  update(dtSeconds: number): void;
}
