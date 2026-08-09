/**
 * Tuning values for the game. Everything spatial is expressed in *tiles*, not
 * pixels — the renderer owns the tile-to-pixel scale so the same numbers hold
 * on every screen size.
 */

/** Nominal pixel size of one maze tile at scale 1. */
export const TILE_SIZE = 8;

/** Simulation rate. The loop steps at this fixed rate regardless of frame rate. */
export const TICKS_PER_SECOND = 60;
export const FIXED_TIMESTEP_SECONDS = 1 / TICKS_PER_SECOND;

/**
 * Ceiling on how much time one frame may contribute to the accumulator. After
 * a background tab or a long stall, we drop the excess rather than running a
 * hundred catch-up ticks at once.
 */
export const MAX_FRAME_SECONDS = 0.25;

/** Movement speed in tiles per second. Placeholder — real values come from the mechanics ticket. */
export const PACMAN_SPEED = 8;
export const GHOST_SPEED = 7.5;

/** Starting player state. */
export const STARTING_LIVES = 3;

export const COLORS = {
  background: '#000000',
  wall: '#2121de',
  pacman: '#ffcc00',
  ghosts: ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852'],
} as const;
