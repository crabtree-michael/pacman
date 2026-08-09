// Draws the raster icons that sit next to public/favicon.svg, from the same
// geometry, so the PNG fallbacks can never drift from the SVG.
//
// The shapes and the encoder are the sprite atlas's (`raster.ts`, `png.ts`) —
// a circle minus a sector is exactly Pac-Man, and the atlas already needed a
// supersampling rasterizer and a PNG writer. The icons are regenerated roughly
// never; run it by hand after editing the constants below:
//
//     node tools/generate-icons.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.ts';
import { circle, color, rect, sector, subtract, Raster, type Paint } from './raster.ts';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/** Pac-Man's yellow, matching PACMAN_COLOR in src/render/entity-layer.ts. */
const YELLOW = color('#ffcc00');
/** The game's background, so the opaque icons sit on the same black. */
const BLACK = color('#000000');

/** Body radius as a fraction of half the canvas — a hair of margin all round. */
const RADIUS_RATIO = 30 / 32;
/** Half the mouth opening. Wide, so the wedge survives a 16 px tab. */
const HALF_MOUTH = (55 * Math.PI) / 180;

interface Icon {
  name: string;
  size: number;
  background: Paint | null;
}

const ICONS: readonly Icon[] = [
  // The <link rel="icon"> fallback for browsers without SVG favicon support.
  { name: 'favicon-32.png', size: 32, background: null },
  // iOS home screen. Opaque, because iOS composites transparency onto black
  // anyway and doing it ourselves keeps the corner radius it applies clean.
  { name: 'apple-touch-icon.png', size: 180, background: BLACK },
];

/** RGBA pixels for one icon. Unlike the atlas, these are drawn in pixel units. */
function render(size: number, background: Paint | null): Uint8Array {
  const raster = new Raster(size, size, 1, 0, 0);
  if (background) raster.fill(rect(0, 0, size, size), background);

  const centre = size / 2;
  const radius = centre * RADIUS_RATIO;
  // The mouth opens to the right, so the wedge is the band of angles around 0.
  const body = subtract(
    circle(centre, centre, radius),
    sector(centre, centre, radius, -HALF_MOUTH, HALF_MOUTH),
  );
  raster.fill(body, YELLOW);

  return raster.pixels;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, size, background } of ICONS) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, encodePng(size, size, render(size, background)));
  process.stdout.write(`wrote ${path} (${size}x${size})\n`);
}
