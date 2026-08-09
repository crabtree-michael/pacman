import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../tools/png.ts';

/**
 * The atlas is written by a hand-rolled PNG encoder (see `tools/png.ts`), so
 * the format's own guarantees have to be checked here. The filter choice is the
 * part worth testing: it is per-scanline, it is chosen by a heuristic, and
 * getting it wrong produces a file that is either several times too big or
 * quietly corrupt.
 *
 * These tests decode what the encoder wrote and compare it to what went in,
 * which is the only assertion that catches both.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface Chunk {
  type: string;
  data: Uint8Array;
}

function chunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Chunk[] = [];
  let offset = SIGNATURE.length;

  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    out.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12; // length + type + data + CRC
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undo the per-scanline filters, which is most of what a PNG decoder does. */
function decodePixels(png: Uint8Array, width: number, height: number): Uint8Array {
  const idat = chunks(png).filter((chunk) => chunk.type === 'IDAT');
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk.data)))));

  const stride = width * 4;
  const out = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= 4 ? out[y * stride + x - 4]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= 4 ? out[(y - 1) * stride + x - 4]! : 0;

      const restored =
        filter === 0
          ? value
          : filter === 1
            ? value + left
            : filter === 2
              ? value + up
              : filter === 3
                ? value + ((left + up) >> 1)
                : value + paeth(left, up, upLeft);
      out[y * stride + x] = restored & 0xff;
    }
  }

  return out;
}

/** A picture with flat runs, a gradient and an alpha edge — one per filter. */
function testImage(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x < width / 2 ? 255 : (x * 7) % 256;
      pixels[i + 1] = (y * 13) % 256;
      pixels[i + 2] = 33;
      pixels[i + 3] = y < 2 ? 0 : 255;
    }
  }
  return pixels;
}

describe('the PNG encoder', () => {
  const width = 24;
  const height = 17;
  const pixels = testImage(width, height);
  const png = encodePng(width, height, pixels);

  it('writes a file that starts with the PNG signature', () => {
    expect(Array.from(png.subarray(0, 8))).toEqual(SIGNATURE);
  });

  it('writes the chunks a decoder needs, in order', () => {
    expect(chunks(png).map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares 8-bit RGBA at the size it was given', () => {
    const header = chunks(png)[0]!.data;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    expect(view.getUint32(0)).toBe(width);
    expect(view.getUint32(4)).toBe(height);
    expect(header[8]).toBe(8); // bit depth
    expect(header[9]).toBe(6); // colour type: truecolour with alpha
  });

  it('round-trips every pixel, whichever filter each row picked', () => {
    expect(Array.from(decodePixels(png, width, height))).toEqual(Array.from(pixels));
  });

  it('actually filters — flat art must not cost its raw size', () => {
    const flat = new Uint8Array(64 * 64 * 4).fill(200);
    expect(encodePng(64, 64, flat).length).toBeLessThan(flat.length / 50);
  });

  it('is deterministic, so a rebuilt atlas only shows up when the art changed', () => {
    expect(Array.from(encodePng(width, height, pixels))).toEqual(Array.from(png));
  });

  it('refuses a buffer that is not the size it claims', () => {
    expect(() => encodePng(4, 4, new Uint8Array(10))).toThrow(/RGBA/);
  });
});
