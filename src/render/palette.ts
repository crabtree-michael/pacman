import type { FruitKind } from '../sim/types';

/**
 * Colours shared between the canvas and the DOM chrome.
 *
 * The status strip's level markers and the fruit drawn on the board are the
 * same object seen twice, so they read from one table rather than two that
 * drift. Everything else each layer styles for itself.
 *
 * TODO(render): the sprite atlas replaces these with real fruit art
 * (architecture §5.1); the colours stay as the HUD's tint for the sprite.
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
