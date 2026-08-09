/**
 * The audio sprite, synthesised (architecture §5.2).
 *
 * §5.2 asks for one audio sprite — every cue concatenated into a single buffer
 * with a JSON offset map — so there is one decode, one object to keep, and
 * sample-accurate playback through `AudioBufferSourceNode`. That is exactly
 * what this produces; what it does not do is fetch it. The cues are the
 * arcade's own vocabulary of square and triangle waves, which means the
 * *recipe* for them is about two kilobytes of data against sixty for an encoded
 * file, there is no format-support matrix to straddle (`.webm/opus` with an
 * `.m4a/aac` fallback), and nothing has to be decoded before the first cue can
 * play. See the README for the trade in full.
 *
 * This module is pure arithmetic over a `Float32Array`: no Web Audio, no DOM,
 * and no clock. That is what lets the whole cue table be tested headlessly.
 */

export type Wave = 'square' | 'triangle' | 'saw' | 'sine' | 'noise';

export interface Segment {
  wave: Wave;
  /** Frequency in Hz at the start of the segment. */
  from: number;
  /** Frequency at the end; defaults to `from`, giving a steady tone. */
  to?: number;
  ms: number;
  /** Peak amplitude, 0..1. Defaults to 1. */
  gain?: number;
}

export interface CueDef {
  segments: readonly Segment[];
  /** Looping cues are cross-faded by the engine; one-shots are fired and forgotten. */
  loop?: boolean;
}

export interface CueSlice {
  /** Seconds into the sprite buffer. */
  offset: number;
  duration: number;
  loop: boolean;
}

export interface Sprite {
  /** Backed by a plain `ArrayBuffer`, which is what `copyToChannel` takes. */
  pcm: Float32Array<ArrayBuffer>;
  sampleRate: number;
  cues: Readonly<Record<string, CueSlice>>;
}

/** Silence between cues, so an overrun of a few samples cannot bleed. */
const GAP_MS = 30;

/**
 * Edge fade, in milliseconds.
 *
 * Every cue starts and ends at zero amplitude. Without it a square wave cut
 * mid-cycle clicks — on a one-shot once, and on a loop every time round.
 */
const FADE_MS = 3;

/** A deterministic noise source: the death cue must not vary between plays. */
function noiseAt(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function sample(wave: Wave, phase: number, index: number): number {
  switch (wave) {
    case 'square':
      return phase % 1 < 0.5 ? 1 : -1;
    case 'triangle':
      return 4 * Math.abs((phase % 1) - 0.5) - 1;
    case 'saw':
      return 2 * (phase % 1) - 1;
    case 'sine':
      return Math.sin(phase * Math.PI * 2);
    case 'noise':
      return noiseAt(index);
  }
}

/** Render one cue into a fresh buffer. */
export function renderCue(cue: CueDef, sampleRate: number): Float32Array<ArrayBuffer> {
  const total = cue.segments.reduce(
    (sum, segment) => sum + Math.round((segment.ms / 1000) * sampleRate),
    0,
  );
  const out = new Float32Array(total);

  // The phase accumulates across segments so a sweep from one segment into the
  // next is continuous — restarting the phase per segment is the other way to
  // get a click.
  let phase = 0;
  let cursor = 0;

  for (const segment of cue.segments) {
    const length = Math.round((segment.ms / 1000) * sampleRate);
    const gain = segment.gain ?? 1;
    const to = segment.to ?? segment.from;

    for (let i = 0; i < length; i++) {
      const t = length <= 1 ? 0 : i / (length - 1);
      const frequency = segment.from + (to - segment.from) * t;
      out[cursor + i] = sample(segment.wave, phase, cursor + i) * gain;
      phase += frequency / sampleRate;
    }
    cursor += length;
  }

  applyEdgeFade(out, sampleRate);
  return out;
}

function applyEdgeFade(buffer: Float32Array, sampleRate: number): void {
  const fade = Math.min(Math.floor((FADE_MS / 1000) * sampleRate), Math.floor(buffer.length / 2));
  for (let i = 0; i < fade; i++) {
    const ramp = i / fade;
    buffer[i] = buffer[i]! * ramp;
    buffer[buffer.length - 1 - i] = buffer[buffer.length - 1 - i]! * ramp;
  }
}

/**
 * Concatenate every cue into one buffer and record where each one starts.
 *
 * The result is the audio sprite: one object, one offset map, and playback that
 * is a `start(0, offset, duration)` away.
 */
export function renderSprite(
  cues: Readonly<Record<string, CueDef>>,
  sampleRate: number,
): Sprite {
  const gap = Math.round((GAP_MS / 1000) * sampleRate);
  const rendered = Object.entries(cues).map(([name, cue]) => ({
    name,
    loop: cue.loop ?? false,
    samples: renderCue(cue, sampleRate),
  }));

  const total = rendered.reduce((sum, entry) => sum + entry.samples.length + gap, 0);
  const pcm = new Float32Array(total);
  const map: Record<string, CueSlice> = {};

  let cursor = 0;
  for (const entry of rendered) {
    pcm.set(entry.samples, cursor);
    map[entry.name] = {
      offset: cursor / sampleRate,
      duration: entry.samples.length / sampleRate,
      loop: entry.loop,
    };
    cursor += entry.samples.length + gap;
  }

  return { pcm, sampleRate, cues: map };
}
