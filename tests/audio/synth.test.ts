import { describe, expect, it } from 'vitest';
import { CUES, Cue, SIREN_TIERS, sirenCue } from '../../src/audio/cues';
import { renderCue, renderSprite } from '../../src/audio/synth';

/**
 * The audio sprite is generated rather than fetched (see `audio/synth.ts`),
 * which means the things a file format would have guaranteed have to be
 * asserted instead: that every cue is in the map, that the offsets address the
 * right samples, and that nothing starts or ends on a step — a square wave cut
 * mid-cycle is an audible click, and on a loop it is a click every time round.
 */

const RATE = 44_100;

describe('cue rendering', () => {
  it('renders a cue at the requested sample rate', () => {
    const cue = { segments: [{ wave: 'square' as const, from: 440, ms: 100 }] };
    expect(renderCue(cue, RATE)).toHaveLength(Math.round(0.1 * RATE));
    expect(renderCue(cue, 22_050)).toHaveLength(Math.round(0.1 * 22_050));
  });

  it('starts and ends at silence, so nothing clicks', () => {
    for (const [name, cue] of Object.entries(CUES)) {
      const samples = renderCue(cue, RATE);
      // `Math.abs`, because a fade to zero of a negative sample lands on -0.
      expect(Math.abs(samples[0]!), `${name} starts on a step`).toBe(0);
      expect(Math.abs(samples.at(-1)!), `${name} ends on a step`).toBe(0);
    }
  });

  it('stays inside the amplitude range, so nothing clips', () => {
    for (const [name, cue] of Object.entries(CUES)) {
      const peak = renderCue(cue, RATE).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      expect(peak, `${name} peak`).toBeLessThanOrEqual(1);
      expect(peak, `${name} is silent`).toBeGreaterThan(0);
    }
  });

  it('is deterministic, noise included', () => {
    const first = renderCue(CUES[Cue.Death]!, RATE);
    const second = renderCue(CUES[Cue.Death]!, RATE);
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe('the sprite', () => {
  const sprite = renderSprite(CUES, RATE);

  it('holds every cue, with the loops marked', () => {
    for (const name of Object.keys(CUES)) {
      expect(sprite.cues[name], name).toBeDefined();
    }
    for (let tier = 0; tier < SIREN_TIERS; tier++) {
      expect(sprite.cues[sirenCue(tier)]?.loop, `siren ${tier}`).toBe(true);
    }
    expect(sprite.cues[Cue.ChompA]?.loop).toBe(false);
  });

  it('gives each cue a slice that lies inside the buffer and overlaps no other', () => {
    const slices = Object.values(sprite.cues).sort((a, b) => a.offset - b.offset);
    let previousEnd = 0;
    for (const slice of slices) {
      expect(slice.offset).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = slice.offset + slice.duration;
      expect(previousEnd).toBeLessThanOrEqual(sprite.pcm.length / RATE);
    }
  });

  it('separates the cues with silence, so an overrun cannot bleed', () => {
    const slice = sprite.cues[Cue.ChompA]!;
    const justPast = Math.round((slice.offset + slice.duration) * RATE) + 20;
    expect(sprite.pcm[justPast]).toBe(0);
  });

  it('costs a fraction of the 60 kB an encoded sprite was budgeted', () => {
    // The recipe is what ships; this is only what it expands to in memory.
    const megabytes = (sprite.pcm.length * 4) / 1024 / 1024;
    expect(megabytes, 'sprite buffer, MB').toBeLessThan(2);
  });
});
