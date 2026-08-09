import { CUES } from './cues';
import { renderSprite, type Sprite } from './synth';

/**
 * The audio engine: one context, one sprite buffer, and a gain node to mute
 * (architecture §5.2).
 *
 * Three constraints shape this module.
 *
 * **Autoplay.** iOS Safari leaves an `AudioContext` suspended until a user
 * gesture, so the context is not created until `unlock()` is called from one —
 * which is what the attract screen's TAP TO PLAY target is partly for. It can
 * also fall back to suspended after a phone call or an app switch, so
 * `resumeIfSuspended` is called again on every `visibilitychange`
 * (architecture §10).
 *
 * **Latency.** `<audio>` elements are unusable for a chomp: iOS caps how many
 * can play at once and their start latency is tens of milliseconds. Every cue
 * here is a slice of one `AudioBuffer` fired through an
 * `AudioBufferSourceNode`, which is sample-accurate and free to overlap.
 *
 * **Muting must not touch the game.** Mute sets a gain to zero. It never stops
 * the simulation clock, never skips an event, and cannot change what happens on
 * the board (architecture §3.2).
 */

/** Milliseconds to cross-fade between two loops. */
const CROSSFADE_MS = 140;

/** Headroom, so a chomp on top of the siren and a jingle cannot clip. */
const MASTER_GAIN = 0.55;

interface LoopVoice {
  name: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type ContextConstructor = new () => AudioContext;

function audioContextConstructor(): ContextConstructor | null {
  const scope = globalThis as {
    AudioContext?: ContextConstructor;
    webkitAudioContext?: ContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private sprite: Sprite | null = null;
  private loop: LoopVoice | null = null;
  private muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  static get isSupported(): boolean {
    return audioContextConstructor() !== null;
  }

  get isRunning(): boolean {
    return this.context?.state === 'running';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Create and start the context. Must be called from a user gesture.
   *
   * Synthesising the sprite happens here rather than at boot because the cues
   * are rendered at the context's own sample rate, which is not known until it
   * exists. It is a few milliseconds of arithmetic on a tap that is already a
   * screen transition, and it buys playback with no resampling.
   */
  unlock(): void {
    if (this.context) {
      this.resumeIfSuspended();
      return;
    }

    const Constructor = audioContextConstructor();
    if (!Constructor) return;

    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : MASTER_GAIN;
    master.connect(context.destination);

    const sprite = renderSprite(CUES, context.sampleRate);
    const buffer = context.createBuffer(1, sprite.pcm.length, sprite.sampleRate);
    buffer.copyToChannel(sprite.pcm, 0);

    this.context = context;
    this.master = master;
    this.sprite = sprite;
    this.buffer = buffer;
    this.resumeIfSuspended();
  }

  /**
   * Re-check the context's state and resume it if the platform suspended it
   * behind our back — a phone call, an app switch, a Bluetooth handover.
   */
  resumeIfSuspended(): void {
    if (this.context?.state === 'suspended') void this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.context) return;
    // A ramp rather than a jump: setting a gain to zero on a sample boundary is
    // audible as a click on a loop that is mid-cycle.
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.context.currentTime, 0.01);
  }

  /** Fire a one-shot cue. Unknown names and a locked context are no-ops. */
  play(name: string): void {
    const slice = this.sprite?.cues[name];
    const context = this.context;
    if (!slice || !context || !this.buffer || !this.master) return;

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.master);
    source.start(0, slice.offset, slice.duration);
  }

  /**
   * Choose the looping cue that should be running, cross-fading from whatever
   * is running now. `null` fades everything out.
   *
   * Asking for the loop that is already playing does nothing at all — that is
   * what lets the caller state the desired loop every tick without restarting
   * the siren sixty times a second.
   */
  setLoop(name: string | null): void {
    if (this.loop?.name === name) return;
    const context = this.context;
    if (!context || !this.buffer || !this.master) return;

    const now = context.currentTime;
    const fade = CROSSFADE_MS / 1000;

    if (this.loop) {
      const previous = this.loop;
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + fade);
      previous.source.stop(now + fade);
      this.loop = null;
    }

    if (name === null) return;
    const slice = this.sprite?.cues[name];
    if (!slice) return;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    gain.connect(this.master);

    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = slice.offset;
    source.loopEnd = slice.offset + slice.duration;
    source.connect(gain);
    source.start(0, slice.offset);

    this.loop = { name, source, gain };
  }

  destroy(): void {
    this.setLoop(null);
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.buffer = null;
    this.sprite = null;
  }
}
