import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAtlas, serialiseManifest, type AtlasBuild } from './atlas.ts';
import { encodePng } from './png.ts';

/**
 * Write the sprite atlas to `public/assets/` (architecture §5.1).
 *
 * Run with `npm run build:assets`. The output is checked in, so a plain
 * `npm install && npm run build` needs no asset step, and a change to the art
 * shows up in review as a diff of `tools/sprite-art.ts` plus a new binary
 * rather than as an opaque blob nobody can trace back to a source. A rebuild
 * that was forgotten fails `tests/tools/atlas.test.ts`.
 *
 * `--preview` also writes a copy over the maze's own blue to a temporary file.
 * The shipped atlas is transparent and much of the art is white, so it is close
 * to invisible in an image viewer — and sprite work has to be judged against
 * the background it will actually sit on.
 */

function writePreview(build: AtlasBuild): void {
  const backdrop = [8, 8, 32];
  const flattened = new Uint8Array(build.pixels.length);
  for (let i = 0; i < build.pixels.length; i += 4) {
    const alpha = build.pixels[i + 3]! / 255;
    for (let channel = 0; channel < 3; channel++) {
      flattened[i + channel] = Math.round(
        build.pixels[i + channel]! * alpha + backdrop[channel]! * (1 - alpha),
      );
    }
    flattened[i + 3] = 255;
  }

  const path = join(tmpdir(), 'pacman-atlas-preview.png');
  writeFileSync(path, encodePng(build.width, build.height, flattened));
  process.stdout.write(`preview     ${path}\n`);
}

const build = buildAtlas();
if (process.argv.includes('--preview')) writePreview(build);

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sprites.png'), build.png);
writeFileSync(join(outDir, 'sprites.json'), serialiseManifest(build.manifest));

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} kB`;
process.stdout.write(
  `sprites.png  ${build.width}x${build.height}, ${build.frameCount} frames, ${kb(build.png.length)}\n`,
);
