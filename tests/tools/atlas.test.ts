import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAtlas, serialiseManifest } from '../../tools/atlas.ts';

/**
 * The atlas is generated but checked in, which buys a build with no asset step
 * and a reviewable diff — at the cost of one failure mode: art edited without
 * anyone running `npm run build:assets`. The game would then ship with the old
 * sprites and nothing would say so.
 *
 * Rebuilding here and comparing to the file on disk closes that. It also pins
 * the build's determinism, which is what makes the comparison possible at all.
 */

const assetUrl = (name: string): URL => new URL(`../../public/assets/${name}`, import.meta.url);

describe('the checked-in atlas', () => {
  const build = buildAtlas();

  it('is what the current art definitions produce', () => {
    const onDisk = new Uint8Array(readFileSync(assetUrl('sprites.png')));
    expect(
      build.png.length,
      'public/assets/sprites.png is stale — run `npm run build:assets`',
    ).toBe(onDisk.length);
    expect(Buffer.from(build.png).equals(Buffer.from(onDisk))).toBe(true);
  });

  it('matches the frame map on disk, byte for byte', () => {
    expect(serialiseManifest(build.manifest)).toBe(readFileSync(assetUrl('sprites.json'), 'utf8'));
  });

  it('builds the same bytes twice', () => {
    const again = buildAtlas();
    expect(Buffer.from(again.png).equals(Buffer.from(build.png))).toBe(true);
  });
});
