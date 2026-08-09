/**
 * Tile ↔ pixel transforms and device-pixel-ratio handling (architecture §2.3).
 *
 * Everything else draws in tile units. This module is the only place that knows
 * about CSS pixels, device pixels, or where the board sits on screen.
 */

/** Fill-rate ceiling from the product spec §5: render at most 3x. */
export const MAX_DPR = 3;

/**
 * If snapping the tile size down to a whole number of device pixels costs less
 * than this fraction of the fit, take it — crisp pixel art is worth a hairline
 * of letterbox (architecture §2.3).
 */
const SNAP_TOLERANCE = 0.08;

export interface Viewport {
  /** CSS pixels per tile. */
  tileSize: number;
  /** CSS-pixel offset of the board's top-left corner within the canvas. */
  originX: number;
  originY: number;
  dpr: number;
  cssWidth: number;
  cssHeight: number;
}

export function computeViewport(
  cssWidth: number,
  cssHeight: number,
  cols: number,
  rows: number,
  rawDpr: number,
): Viewport {
  const dpr = Math.min(rawDpr || 1, MAX_DPR);

  const fitted = Math.min(cssWidth / cols, cssHeight / rows);
  const deviceTile = fitted * dpr;
  const snapped = Math.floor(deviceTile);
  const tileSize =
    snapped >= 1 && (deviceTile - snapped) / deviceTile <= SNAP_TOLERANCE
      ? snapped / dpr
      : fitted;

  return {
    tileSize,
    originX: Math.round((cssWidth - tileSize * cols) / 2),
    originY: Math.round((cssHeight - tileSize * rows) / 2),
    dpr,
    cssWidth,
    cssHeight,
  };
}

export interface PrepareOptions {
  /**
   * Whether `drawImage` may interpolate.
   *
   * Off for the layers that draw paths, where it does nothing. On for the
   * entity layer: the atlas stores frames at 4x the tile size, so a sprite is
   * nearly always drawn smaller than its source, and bilinear downsampling is
   * what keeps a moving character clean where nearest sampling would drop
   * pixels and crawl (architecture §2.3).
   */
  smoothing?: boolean;
}

/**
 * Size a canvas's backing store to the viewport and set the transform so all
 * drawing code can work in tile units.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  viewport: Viewport,
  options: PrepareOptions = {},
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas context unavailable');
  }

  canvas.style.width = `${viewport.cssWidth}px`;
  canvas.style.height = `${viewport.cssHeight}px`;
  canvas.width = Math.round(viewport.cssWidth * viewport.dpr);
  canvas.height = Math.round(viewport.cssHeight * viewport.dpr);

  const scale = viewport.tileSize * viewport.dpr;
  context.setTransform(
    scale,
    0,
    0,
    scale,
    viewport.originX * viewport.dpr,
    viewport.originY * viewport.dpr,
  );
  context.imageSmoothingEnabled = options.smoothing ?? false;
  if (context.imageSmoothingEnabled) context.imageSmoothingQuality = 'high';
  return context;
}

/** Clear a context that has a tile-unit transform applied. */
export function clearTiles(
  context: CanvasRenderingContext2D,
  cols: number,
  rows: number,
): void {
  context.clearRect(-1, -1, cols + 2, rows + 2);
}
