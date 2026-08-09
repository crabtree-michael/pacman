import { encodePng } from './png.ts';
import { Raster } from './raster.ts';
import { ATLAS_TILE_PX, allFrames, drawFrame, type FrameDef } from './sprite-art.ts';

/**
 * Pack and render the sprite atlas (architecture §5.1).
 *
 * Pure: it reads the art definitions and returns bytes. `build-sprites.ts` is
 * the half that touches the filesystem, and keeping the two apart is what lets
 * `tests/tools` rebuild the atlas and compare it to the one that is checked in
 * — so art edited without a rebuild fails a test rather than shipping stale.
 *
 * The output is deterministic — same art in, byte-identical file out — which is
 * also what makes "did the atlas change?" a question `git status` can answer.
 */

/** Transparent gutter between frames, so bilinear sampling cannot bleed. */
const PADDING = 2;

/** Atlas width. Fixed rather than fitted, to keep the packing stable. */
const ATLAS_WIDTH = 512;

interface Placement {
  frame: FrameDef;
  raster: Raster;
  x: number;
  y: number;
}

/**
 * Shelf packing, tallest first: rows of frames, each row as tall as its
 * tallest member. With two frame sizes — 2x2-tile characters and 5x7 glyphs —
 * this wastes a couple of hundred bytes and needs no bin-packing library.
 */
function pack(frames: readonly FrameDef[]): { placements: Placement[]; height: number } {
  const sized = frames
    .map((frame) => ({
      frame,
      raster: new Raster(
        Math.round(frame.width * ATLAS_TILE_PX),
        Math.round(frame.height * ATLAS_TILE_PX),
        ATLAS_TILE_PX,
        -frame.pivotX,
        -frame.pivotY,
      ),
    }))
    // Ties break on name so the layout does not depend on `Object.keys` order.
    .sort(
      (a, b) => b.raster.height - a.raster.height || a.frame.name.localeCompare(b.frame.name),
    );

  const placements: Placement[] = [];
  let shelfY = PADDING;
  let shelfHeight = 0;
  let cursorX = PADDING;

  for (const item of sized) {
    // A new shelf when the row is full, and also when the frame height changes:
    // homogeneous shelves cost a few pixels of slack and buy a glyph strip that
    // is one contiguous rectangle, which is what the runtime tint copies.
    const changedSize = shelfHeight !== 0 && item.raster.height !== shelfHeight;
    if (changedSize || cursorX + item.raster.width + PADDING > ATLAS_WIDTH) {
      shelfY += shelfHeight + PADDING;
      shelfHeight = 0;
      cursorX = PADDING;
    }
    placements.push({ ...item, x: cursorX, y: shelfY });
    cursorX += item.raster.width + PADDING;
    shelfHeight = Math.max(shelfHeight, item.raster.height);
  }

  return { placements, height: shelfY + shelfHeight + PADDING };
}

/**
 * The rectangle every glyph frame lives inside.
 *
 * Glyphs are drawn white and tinted at runtime, and tinting means copying the
 * pixels through a composite pass. Knowing where the glyphs are keeps that copy
 * to a strip a few dozen rows tall instead of the whole atlas — see
 * `render/atlas.ts`. The shelf packer sorts by height, and glyphs are the only
 * short frames, so they always land on shelves of their own; this asserts that
 * rather than trusting it.
 */
function glyphStripOf(placements: readonly Placement[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const isGlyph = (placement: Placement): boolean => placement.frame.name.startsWith('glyph:');
  const glyphs = placements.filter(isGlyph);
  if (glyphs.length === 0) throw new Error('No glyph frames in the atlas');

  const x = Math.min(...glyphs.map((p) => p.x));
  const y = Math.min(...glyphs.map((p) => p.y));
  const right = Math.max(...glyphs.map((p) => p.x + p.raster.width));
  const bottom = Math.max(...glyphs.map((p) => p.y + p.raster.height));

  for (const placement of placements) {
    if (isGlyph(placement)) continue;
    const overlaps =
      placement.x < right &&
      placement.x + placement.raster.width > x &&
      placement.y < bottom &&
      placement.y + placement.raster.height > y;
    if (overlaps) {
      throw new Error(`Frame "${placement.frame.name}" sits inside the glyph strip`);
    }
  }

  return { x, y, w: right - x, h: bottom - y };
}


export interface AtlasBuild {
  png: Uint8Array;
  /** The RGBA buffer the PNG was made from, for the `--preview` backdrop. */
  pixels: Uint8Array;
  width: number;
  height: number;
  manifest: Record<string, unknown>;
  frameCount: number;
}

export function buildAtlas(): AtlasBuild {
  const frames = allFrames();
  const { placements, height } = pack(frames);

  const pixels = new Uint8Array(ATLAS_WIDTH * height * 4);
  for (const placement of placements) {
    drawFrame(placement.raster, placement.frame);
    placement.raster.blitInto(pixels, ATLAS_WIDTH, placement.x, placement.y);
  }

  const manifest = {
    image: 'sprites.png',
    width: ATLAS_WIDTH,
    height,
    /** Atlas pixels per maze tile — the renderer's tile↔frame conversion. */
    tileSize: ATLAS_TILE_PX,
    glyphStrip: glyphStripOf(placements),
    frames: Object.fromEntries(
      placements
        .map((placement) => [
          placement.frame.name,
          {
            x: placement.x,
            y: placement.y,
            w: placement.raster.width,
            h: placement.raster.height,
            pivotX: Math.round(placement.frame.pivotX * ATLAS_TILE_PX),
            pivotY: Math.round(placement.frame.pivotY * ATLAS_TILE_PX),
          },
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  };

  return {
    png: encodePng(ATLAS_WIDTH, height, pixels),
    pixels,
    width: ATLAS_WIDTH,
    height,
    manifest,
    frameCount: frames.length,
  };
}

/** How the manifest is written to disk, and therefore how it is compared. */
export function serialiseManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
