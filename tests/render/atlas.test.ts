import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chompPhase, deathFrame } from '../../src/render/entity-layer';
import {
  Atlas,
  CHOMP_PHASES,
  DEATH_FRAMES,
  GHOST_PHASES,
  frameName,
  type AtlasManifest,
} from '../../src/render/atlas';
import { DYING_MS } from '../../src/sim/phases';
import { Direction, type FruitKind, type GhostName } from '../../src/sim/types';

/**
 * The atlas contract, checked against the atlas that will actually ship.
 *
 * `tools/build-sprites` writes the frame names and `render/atlas` reads them.
 * Nothing in the type system connects the two, and a name that does not match
 * fails silently — `Atlas.draw` skips a frame it cannot find, because a
 * renderer is not worth crashing a game over. This is what stops that
 * shipping: every name the renderer can ask for, asked for.
 */

const manifest = JSON.parse(
  readFileSync(new URL('../../public/assets/sprites.json', import.meta.url), 'utf8'),
) as AtlasManifest;

const DIRECTIONS = [Direction.Up, Direction.Down, Direction.Left, Direction.Right];
const GHOSTS: GhostName[] = ['blinky', 'pinky', 'inky', 'clyde'];
const FRUIT: FruitKind[] = [
  'cherry',
  'strawberry',
  'orange',
  'apple',
  'melon',
  'galaxian',
  'bell',
  'key',
];

/** Everything the overlay cards, the HUD and the score bubbles can spell. */
const TEXT = 'PAC-MAN TAP TO PLAY READY! GAME OVER PAUSED RESUME LEVEL 0123456789';

function names(): string[] {
  const wanted: string[] = [];

  for (const direction of DIRECTIONS) {
    for (let phase = 0; phase < CHOMP_PHASES; phase++) {
      wanted.push(frameName.pacman(direction, phase));
    }
    wanted.push(frameName.eyes(direction));
  }
  for (let index = 0; index < DEATH_FRAMES; index++) wanted.push(frameName.death(index));
  for (const ghost of GHOSTS) {
    for (let phase = 0; phase < GHOST_PHASES; phase++) wanted.push(frameName.ghost(ghost, phase));
  }
  for (let phase = 0; phase < GHOST_PHASES; phase++) {
    wanted.push(frameName.fright(phase, false));
    wanted.push(frameName.fright(phase, true));
  }
  for (const kind of FRUIT) wanted.push(frameName.fruit(kind));
  for (const character of new Set(TEXT.replace(/ /g, ''))) {
    wanted.push(frameName.glyph(character));
  }

  return wanted;
}

describe('the shipped sprite atlas', () => {
  it('has every frame the renderer can ask for', () => {
    const missing = names().filter((name) => !(name in manifest.frames));
    expect(missing).toEqual([]);
  });

  it('keeps every frame inside the image', () => {
    for (const [name, frame] of Object.entries(manifest.frames)) {
      expect(frame.x + frame.w, `${name} right edge`).toBeLessThanOrEqual(manifest.width);
      expect(frame.y + frame.h, `${name} bottom edge`).toBeLessThanOrEqual(manifest.height);
    }
  });

  it('holds every glyph inside the strip the runtime tint copies', () => {
    const strip = manifest.glyphStrip;
    for (const [name, frame] of Object.entries(manifest.frames)) {
      if (!name.startsWith('glyph:')) continue;
      expect(frame.x, name).toBeGreaterThanOrEqual(strip.x);
      expect(frame.y, name).toBeGreaterThanOrEqual(strip.y);
      expect(frame.x + frame.w, name).toBeLessThanOrEqual(strip.x + strip.w);
      expect(frame.y + frame.h, name).toBeLessThanOrEqual(strip.y + strip.h);
    }
  });

  it('centres character frames on the actor', () => {
    const frame = manifest.frames[frameName.pacman(Direction.Right, 0)]!;
    expect(frame.pivotX).toBe(frame.w / 2);
    expect(frame.pivotY).toBe(frame.h / 2);
    // Two tiles across, as the renderer's positioning assumes.
    expect(frame.w / manifest.tileSize).toBe(2);
  });

  it('stays inside the architecture’s 20 kB estimate for the atlas', () => {
    const png = readFileSync(new URL('../../public/assets/sprites.png', import.meta.url));
    expect(png.byteLength).toBeLessThanOrEqual(20 * 1024);
  });
});

describe('text layout', () => {
  const atlas = new Atlas(manifest, {
    width: manifest.width,
    height: manifest.height,
  } as never);

  it('measures a string as its glyphs plus the gaps between them', () => {
    // Five columns per glyph and one blank between, at a seven-row height.
    const height = 0.7;
    const pixel = height / 7;
    expect(atlas.measureText('AB', height)).toBeCloseTo(11 * pixel);
    expect(atlas.measureText('', height)).toBe(0);
  });

  it('scales with the height it is given, so text tracks the maze', () => {
    expect(atlas.measureText('1600', 1.4)).toBeCloseTo(atlas.measureText('1600', 0.7) * 2);
  });
});

describe('animation cursors', () => {
  it('walks the chomp through open, half, shut, half', () => {
    expect(chompPhase(0)).toBe(CHOMP_PHASES - 1);
    expect(chompPhase(4)).toBe(1);
    expect(chompPhase(8)).toBe(0);
    expect(chompPhase(12)).toBe(1);
    // And repeats, rather than running off the end of the frame list.
    expect(chompPhase(16)).toBe(chompPhase(0));
    for (let ticks = 0; ticks < 100; ticks++) {
      expect(chompPhase(ticks)).toBeGreaterThanOrEqual(0);
      expect(chompPhase(ticks)).toBeLessThan(CHOMP_PHASES);
    }
  });

  it('holds Pac-Man still, plays the death frames, then clears the board', () => {
    // The clock counts *down*, so a full timer is the moment of death.
    expect(deathFrame(DYING_MS)).toBe(0);
    expect(deathFrame(DYING_MS - 100)).toBe(0); // Still inside the hold.
    expect(deathFrame(DYING_MS - 400)).toBe(0); // First animated frame.
    expect(deathFrame(DYING_MS - 400 - 90 * 5)).toBe(5);
    // The animation fits inside the phase, and the board is empty at the end.
    expect(deathFrame(DYING_MS - 400 - 90 * (DEATH_FRAMES - 1))).toBe(DEATH_FRAMES - 1);
    expect(deathFrame(0)).toBeNull();
  });
});
