import type { FruitKind } from '../sim/types';

/**
 * Colours shared between the canvas and the DOM chrome.
 *
 * The status strip's level markers and the fruit drawn on the board are the
 * same object seen twice, so they read from one table rather than two that
 * drift. Everything else each layer styles for itself.
 *
 * The fruit sprites come from the atlas; these colours stay as the HUD's
 * shorthand for the same fruit, where a 10 px marker has no room for art.
 */
export const FRUIT_COLORS: Readonly<Record<FruitKind, string>> = {
  cherry: '#ff2b2b',
  strawberry: '#ff5f8d',
  orange: '#ffa02b',
  apple: '#e02020',
  melon: '#7cd94f',
  galaxian: '#5cc8ff',
  bell: '#ffe14d',
  key: '#a9c7ff',
};

export interface MazePalette {
  wall: string;
  door: string;
}

/**
 * A maze palette per level (product spec §4.1: "the same maze layout with
 * different palettes").
 *
 * Because the maze is drawn procedurally, a re-skin is this table and nothing
 * else — no second set of art, and no rebuild.
 */
const MAZE_PALETTES: readonly MazePalette[] = [
  { wall: '#2121de', door: '#ffb8ff' },
  { wall: '#22b1c4', door: '#ffb8ff' },
  { wall: '#c93fa2', door: '#ffd6a0' },
  { wall: '#2f9e44', door: '#ffb8ff' },
  { wall: '#d1731a', door: '#a9c7ff' },
];

/** The flash that announces a cleared board (product spec §4.5). */
export const MAZE_FLASH: MazePalette = { wall: '#ffffff', door: '#ffffff' };

export function paletteForLevel(level: number): MazePalette {
  const index = Math.max(0, level - 1) % MAZE_PALETTES.length;
  return MAZE_PALETTES[index] as MazePalette;
}
