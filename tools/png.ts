import { deflateSync } from 'node:zlib';

/**
 * A minimal PNG encoder — 8-bit RGBA, one IDAT, no dependencies.
 *
 * The sprite atlas is generated at build time (architecture §5.1), which means
 * something has to turn pixels into a file. Every encoder on npm is either a
 * native module (a compiler toolchain in CI, for one build step) or drags in a
 * decoder, a resizer and a colour-management stack we would never call. PNG's
 * container is a length-tagged chunk list and its compression is plain deflate,
 * which `node:zlib` already provides, so the whole format that we need is the
 * ~90 lines below.
 *
 * Output is deterministic: the same art definitions produce a byte-identical
 * file, so a regenerated atlas shows up in `git status` only when the art
 * actually changed.
 */

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Colour type 6: truecolour with an alpha channel. */
const COLOR_TYPE_RGBA = 6;
const BYTES_PER_PIXEL = 4;

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

/**
 * Pick a per-scanline filter, PNG's own heuristic: the candidate whose filtered
 * bytes have the smallest sum of absolute signed values. Filtering is what makes
 * flat art compress — a row of one colour becomes a row of zeroes — and getting
 * it wrong costs several times the file size rather than a few per cent.
 */
function filterScanline(
  row: Uint8Array,
  previous: Uint8Array,
  output: Uint8Array,
  offset: number,
): void {
  const width = row.length;
  const candidates: Uint8Array[] = [];
  for (let type = 0; type < 5; type++) {
    candidates.push(new Uint8Array(width));
  }

  for (let i = 0; i < width; i++) {
    const raw = row[i]!;
    const left = i >= BYTES_PER_PIXEL ? row[i - BYTES_PER_PIXEL]! : 0;
    const up = previous[i]!;
    const upLeft = i >= BYTES_PER_PIXEL ? previous[i - BYTES_PER_PIXEL]! : 0;

    candidates[0]![i] = raw;
    candidates[1]![i] = (raw - left) & 0xff;
    candidates[2]![i] = (raw - up) & 0xff;
    candidates[3]![i] = (raw - ((left + up) >> 1)) & 0xff;
    candidates[4]![i] = (raw - paeth(left, up, upLeft)) & 0xff;
  }

  let bestType = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let type = 0; type < candidates.length; type++) {
    let score = 0;
    for (const byte of candidates[type]!) {
      score += byte < 128 ? byte : 256 - byte;
    }
    if (score < bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  output[offset] = bestType;
  output.set(candidates[bestType]!, offset + 1);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const dLeft = Math.abs(p - left);
  const dUp = Math.abs(p - up);
  const dUpLeft = Math.abs(p - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

/** Encode an RGBA buffer (row-major, 4 bytes per pixel) as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * BYTES_PER_PIXEL;
  if (rgba.length !== stride * height) {
    throw new Error(`Expected ${stride * height} bytes of RGBA, got ${rgba.length}`);
  }

  const raw = new Uint8Array((stride + 1) * height);
  let previous: Uint8Array<ArrayBufferLike> = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    filterScanline(row, previous, raw, y * (stride + 1));
    previous = row;
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = COLOR_TYPE_RGBA;
  // Compression 0, filter 0, interlace 0 — the only values PNG defines.

  const chunks = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    file.set(part, offset);
    offset += part.length;
  }
  return file;
}
