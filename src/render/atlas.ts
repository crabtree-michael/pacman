import { Direction, type FruitKind, type GhostName } from '../sim/types';

/**
 * The sprite atlas: frame lookup and drawing helpers (architecture §5.1, §6).
 *
 * One image and one frame map, generated at build time by `tools/build-sprites`
 * and decoded once at boot. Everything that moves comes from here; the maze
 * itself stays procedural, because it is resolution-independent and a level
 * re-skin is a palette swap rather than new art.
 *
 * Drawing happens in tile units, like the rest of `render/`. `tileSize` in the
 * manifest is the only number that connects atlas pixels to the board, so a
 * higher-resolution atlas is a rebuild rather than a code change.
 */

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The point the frame is positioned by, in atlas pixels from its top-left. */
  pivotX: number;
  pivotY: number;
}

export interface AtlasManifest {
  image: string;
  width: number;
  height: number;
  /** Atlas pixels per maze tile. */
  tileSize: number;
  /** The rectangle holding the bitmap font, for the runtime tint. */
  glyphStrip: { x: number; y: number; w: number; h: number };
  frames: Readonly<Record<string, AtlasFrame>>;
}

/** Source of an atlas image — an `ImageBitmap` when the platform has one. */
export type AtlasImage = CanvasImageSource & { width: number; height: number };

/** Glyph cell geometry, mirroring the 5x7 font in `tools/sprite-art.ts`. */
const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;
/** One blank art pixel between glyphs, so text does not run together. */
const GLYPH_ADVANCE = GLYPH_COLS + 1;

export type DirectionName = 'right' | 'down' | 'left' | 'up';

const DIRECTION_NAMES: Readonly<Record<Direction, DirectionName>> = {
  [Direction.None]: 'right',
  [Direction.Right]: 'right',
  [Direction.Down]: 'down',
  [Direction.Left]: 'left',
  [Direction.Up]: 'up',
};

export function directionName(direction: Direction): DirectionName {
  return DIRECTION_NAMES[direction];
}

/**
 * Every frame name the renderer can ask for, in one place.
 *
 * The build tool writes these names and the renderer reads them; a typo on
 * either side would be a sprite that silently fails to draw. `tests/render`
 * checks the two lists against each other, so the drift is caught at test time
 * rather than by a player seeing an invisible ghost.
 */
export const frameName = {
  pacman: (direction: Direction, phase: number): string =>
    `pac-${directionName(direction)}-${phase}`,
  death: (index: number): string => `pac-death-${index}`,
  ghost: (name: GhostName, phase: number): string => `ghost-${name}-${phase}`,
  eyes: (direction: Direction): string => `eyes-${directionName(direction)}`,
  fright: (phase: number, flashing: boolean): string =>
    flashing ? `fright-flash-${phase}` : `fright-${phase}`,
  fruit: (kind: FruitKind): string => `fruit-${kind}`,
  glyph: (character: string): string => `glyph:${character}`,
};

/** Chomp phases per direction, and the death animation's frame count. */
export const CHOMP_PHASES = 3;
export const DEATH_FRAMES = 11;
/** Body animation phases shared by the ghosts and the frightened frames. */
export const GHOST_PHASES = 2;

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  /** Glyph height in tile units. */
  height: number;
  color: string;
  align?: TextAlign;
}

/**
 * The CSS needed to show one frame as an element's background.
 *
 * All ratios, no pixels: the element keeps whatever size the stylesheet gave
 * it and the sprite scales to fill it, so the HUD's markers stay correct at any
 * font size or density without the layout having to tell the atlas anything.
 */
export interface SpriteStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
}

export class Atlas {
  private readonly manifest: AtlasManifest;
  private readonly image: AtlasImage;
  private readonly imageUrl: string;
  /** One tinted copy of the glyph strip per colour, built on first use. */
  private readonly tinted = new Map<string, CanvasImageSource>();

  constructor(manifest: AtlasManifest, image: AtlasImage, imageUrl = '') {
    this.manifest = manifest;
    this.image = image;
    this.imageUrl = imageUrl;
  }

  /** Show one frame as a DOM element's background — the HUD's markers. */
  spriteStyle(name: string): SpriteStyle | null {
    const frame = this.manifest.frames[name];
    if (!frame || !this.imageUrl) return null;

    const spanX = this.manifest.width - frame.w;
    const spanY = this.manifest.height - frame.h;
    return {
      backgroundImage: `url("${this.imageUrl}")`,
      backgroundSize: `${(this.manifest.width / frame.w) * 100}% ${(this.manifest.height / frame.h) * 100}%`,
      // Percentage background-position aligns the same fraction of the image
      // with that fraction of the box, which is what puts an arbitrary frame
      // in view without knowing the box's pixel size.
      backgroundPosition: `${spanX > 0 ? (frame.x / spanX) * 100 : 0}% ${
        spanY > 0 ? (frame.y / spanY) * 100 : 0
      }%`,
    };
  }

  /** Atlas pixels per tile — how many tiles a frame of `w` pixels covers. */
  get tileSize(): number {
    return this.manifest.tileSize;
  }

  frame(name: string): AtlasFrame | undefined {
    return this.manifest.frames[name];
  }

  /**
   * Draw a frame with its pivot at (`x`, `y`), in tile units.
   *
   * A missing frame draws nothing rather than throwing: a renderer is not worth
   * crashing a game over, and the frame-name test is what stops one shipping.
   */
  draw(context: CanvasRenderingContext2D, name: string, x: number, y: number): void {
    const frame = this.manifest.frames[name];
    if (!frame) return;
    const scale = 1 / this.manifest.tileSize;
    context.drawImage(
      this.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      x - frame.pivotX * scale,
      y - frame.pivotY * scale,
      frame.w * scale,
      frame.h * scale,
    );
  }

  /** Width of `text` in tile units, at the given glyph height. */
  measureText(text: string, height: number): number {
    const pixel = height / GLYPH_ROWS;
    return text.length === 0 ? 0 : (text.length * GLYPH_ADVANCE - 1) * pixel;
  }

  /**
   * Draw text from the bitmap glyph strip (architecture §5.1).
   *
   * `y` is the top of the glyph cell. Unknown characters advance without
   * drawing, so a space costs no lookup and a stray symbol leaves a gap rather
   * than breaking the line.
   */
  drawText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    options: TextOptions,
  ): void {
    const source = this.tint(options.color);
    if (!source) return;

    const pixel = options.height / GLYPH_ROWS;
    const width = this.measureText(text, options.height);
    const align = options.align ?? 'left';
    let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;

    const strip = this.manifest.glyphStrip;
    for (const character of text.toUpperCase()) {
      const frame = this.manifest.frames[frameName.glyph(character)];
      if (frame) {
        context.drawImage(
          source,
          frame.x - strip.x,
          frame.y - strip.y,
          frame.w,
          frame.h,
          cursor,
          y,
          GLYPH_COLS * pixel,
          GLYPH_ROWS * pixel,
        );
      }
      cursor += GLYPH_ADVANCE * pixel;
    }
  }

  /**
   * A copy of the glyph strip filled with one colour, cached.
   *
   * The font is baked white and recoloured here rather than being baked once
   * per colour: `source-in` over a cropped strip is a few hundred kilobytes of
   * canvas per colour, against a larger atlas and a longer decode for every
   * player whether or not they ever see that colour.
   */
  private tint(color: string): CanvasImageSource | null {
    const cached = this.tinted.get(color);
    if (cached) return cached;

    const strip = this.manifest.glyphStrip;
    const canvas = document.createElement('canvas');
    canvas.width = strip.w;
    canvas.height = strip.h;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(this.image, strip.x, strip.y, strip.w, strip.h, 0, 0, strip.w, strip.h);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, strip.w, strip.h);

    this.tinted.set(color, canvas);
    return canvas;
  }
}

/**
 * Fetch and decode the atlas (architecture §5.3).
 *
 * `createImageBitmap` decodes off the main thread, so the first frame of play
 * is never the one that pays for it. Where it is missing — older WebKit, and
 * jsdom — an `<img>` plus `decode()` gets to the same place on the main thread,
 * which is acceptable during a boot gate that is already waiting.
 */
export async function loadAtlas(basePath = '/assets/'): Promise<Atlas> {
  const manifestResponse = await fetch(`${basePath}sprites.json`);
  if (!manifestResponse.ok) {
    throw new Error(`Could not load the sprite manifest: ${manifestResponse.status}`);
  }
  const manifest = (await manifestResponse.json()) as AtlasManifest;

  const imageUrl = `${basePath}${manifest.image}`;
  const image = await decodeImage(imageUrl);
  return new Atlas(manifest, image, imageUrl);
}

async function decodeImage(url: string): Promise<AtlasImage> {
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load the sprite atlas: ${response.status}`);
    return await createImageBitmap(await response.blob());
  }

  const element = new Image();
  element.src = url;
  await element.decode();
  return element;
}
