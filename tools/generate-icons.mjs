// Draws the raster icons that sit next to public/favicon.svg, from the same
// geometry, so the PNG fallbacks can never drift from the SVG.
//
// Plain Node with zlib rather than a drawing library: two shapes on a flat
// background is not worth a dependency, and the icons are regenerated roughly
// never. Run it by hand after editing the constants below:
//
//     node tools/generate-icons.mjs
//
// Usage: node tools/generate-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/** Pac-Man's yellow, matching PACMAN_COLOR in src/render/entity-layer.ts. */
const YELLOW = [0xff, 0xcc, 0x00];
/** The game's background, so the opaque icons sit on the same black. */
const BLACK = [0x00, 0x00, 0x00];

/** Body radius as a fraction of half the canvas — a hair of margin all round. */
const RADIUS_RATIO = 30 / 32;
/** Half the mouth opening. Wide, so the wedge survives a 16 px tab. */
const HALF_MOUTH = (55 * Math.PI) / 180;
/** Supersampling factor per axis; 4 is enough to hide the stair-steps. */
const SAMPLES = 4;

const ICONS = [
  // The <link rel="icon"> fallback for browsers without SVG favicon support.
  { name: 'favicon-32.png', size: 32, background: null },
  // iOS home screen. Opaque, because iOS composites transparency onto black
  // anyway and doing it ourselves keeps the corner radius it applies clean.
  { name: 'apple-touch-icon.png', size: 180, background: BLACK },
];

/**
 * Coverage of one pixel by the Pac-Man silhouette, in 0..1, by supersampling.
 * A point is inside when it is within the circle and outside the mouth wedge.
 */
function coverage(px, py, size) {
  const centre = size / 2;
  const radius = centre * RADIUS_RATIO;
  let hits = 0;

  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = px + (sx + 0.5) / SAMPLES - centre;
      const y = py + (sy + 0.5) / SAMPLES - centre;

      if (x * x + y * y > radius * radius) continue;
      // The mouth opens to the right, so the wedge is the band of angles
      // around 0. atan2 is signed, which makes the test symmetric for free.
      if (Math.abs(Math.atan2(y, x)) < HALF_MOUTH) continue;

      hits += 1;
    }
  }

  return hits / (SAMPLES * SAMPLES);
}

/** RGBA pixel rows, ready to be filtered and deflated. */
function render(size, background) {
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    // Each scanline is prefixed with its filter type; 0 (none) keeps this
    // encoder to a single concept, and these images are a few KB either way.
    const row = Buffer.alloc(1 + size * 4);

    for (let x = 0; x < size; x += 1) {
      const alpha = coverage(x, y, size);
      const offset = 1 + x * 4;

      if (background) {
        // Composite onto the background so the file is fully opaque.
        for (let channel = 0; channel < 3; channel += 1) {
          row[offset + channel] = Math.round(
            YELLOW[channel] * alpha + background[channel] * (1 - alpha),
          );
        }
        row[offset + 3] = 0xff;
      } else {
        row.set(YELLOW, offset);
        row[offset + 3] = Math.round(alpha * 0xff);
      }
    }

    rows.push(row);
  }

  return Buffer.concat(rows);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Bytes 10-12 are compression, filter and interlace method — 0 is the only
  // value the spec defines for each.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, size, background } of ICONS) {
  const path = join(OUT_DIR, name);
  writeFileSync(path, encodePng(size, render(size, background)));
  console.log(`wrote ${path} (${size}x${size})`);
}
