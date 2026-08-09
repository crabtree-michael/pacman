import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cue, sirenCue } from '../../src/audio/cues';
import { AudioEngine } from '../../src/audio/engine';

/**
 * The engine, against a fake Web Audio graph.
 *
 * Everything worth checking here is a rule about *when* the engine touches the
 * platform, and every one of those rules exists because of a real browser
 * behaviour: iOS will not start a context outside a user gesture, a loop
 * restarted every tick is a siren that never plays, and muting has to be a gain
 * change rather than anything that could reach the simulation.
 */

interface Started {
  when: number;
  offset: number;
  duration: number | undefined;
}

class FakeParam {
  value = 0;
  readonly ramps: { to: number; at: number }[] = [];
  readonly targets: { to: number }[] = [];

  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(to: number, at: number): this {
    this.ramps.push({ to, at });
    return this;
  }

  setTargetAtTime(to: number): this {
    this.targets.push({ to });
    this.value = to;
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  connectedTo: unknown = null;

  connect(target: unknown): void {
    this.connectedTo = target;
  }
}

class FakeSource {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started: Started | null = null;
  stoppedAt: number | null = null;
  connectedTo: unknown = null;

  connect(target: unknown): void {
    this.connectedTo = target;
  }

  start(when: number, offset: number, duration?: number): void {
    this.started = { when, offset, duration };
  }

  stop(when: number): void {
    this.stoppedAt = when;
  }
}

class FakeBuffer {
  readonly channels: Float32Array[] = [];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}

  copyToChannel(source: Float32Array, channel: number): void {
    this.channels[channel] = source;
  }
}

class FakeContext {
  static instances: FakeContext[] = [];

  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  readonly sampleRate = 44_100;
  readonly destination = { id: 'destination' };
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  resumes = 0;

  constructor() {
    FakeContext.instances.push(this);
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

const scope = globalThis as { AudioContext?: unknown };
let original: unknown;

beforeEach(() => {
  original = scope.AudioContext;
  FakeContext.instances = [];
  scope.AudioContext = FakeContext;
});

afterEach(() => {
  scope.AudioContext = original;
});

function unlocked(): { engine: AudioEngine; context: FakeContext } {
  const engine = new AudioEngine();
  engine.unlock();
  return { engine, context: FakeContext.instances[0]! };
}

describe('unlocking', () => {
  it('creates nothing until a gesture arrives', () => {
    const engine = new AudioEngine();
    engine.play(Cue.ChompA);
    engine.setLoop(sirenCue(0));

    expect(FakeContext.instances).toHaveLength(0);
    expect(engine.isRunning).toBe(false);
  });

  it('creates and resumes one context, however many gestures follow', () => {
    const { engine, context } = unlocked();
    engine.unlock();
    engine.unlock();

    expect(FakeContext.instances).toHaveLength(1);
    expect(context.state).toBe('running');
    expect(engine.isRunning).toBe(true);
  });

  /** A phone call or an app switch can suspend a context behind our back. */
  it('resumes a context the platform suspended', () => {
    const { engine, context } = unlocked();
    const before = context.resumes;

    engine.resumeIfSuspended();
    expect(context.resumes, 'a running context should be left alone').toBe(before);

    context.state = 'suspended';
    engine.resumeIfSuspended();
    expect(context.resumes).toBe(before + 1);
  });
});

describe('playback', () => {
  it('fires a one-shot as a slice of the one sprite buffer', () => {
    const { engine, context } = unlocked();
    engine.play(Cue.PowerPellet);

    expect(context.sources).toHaveLength(1);
    const source = context.sources[0]!;
    expect(source.started?.offset).toBeGreaterThan(0);
    expect(source.started?.duration).toBeGreaterThan(0);
    expect(source.loop).toBe(false);
  });

  it('ignores a cue it does not have, rather than throwing at the player', () => {
    const { engine, context } = unlocked();
    engine.play('no-such-cue');
    expect(context.sources).toHaveLength(0);
  });

  it('loops a slice by its own start and end, not the whole buffer', () => {
    const { engine, context } = unlocked();
    engine.setLoop(sirenCue(2));

    const source = context.sources[0]!;
    expect(source.loop).toBe(true);
    expect(source.loopEnd).toBeGreaterThan(source.loopStart);
    expect(source.started?.offset).toBe(source.loopStart);
  });

  it('does nothing when asked for the loop that is already running', () => {
    const { engine, context } = unlocked();
    engine.setLoop(sirenCue(1));
    engine.setLoop(sirenCue(1));
    engine.setLoop(sirenCue(1));

    expect(context.sources, 'the siren was restarted').toHaveLength(1);
  });

  it('cross-fades when the loop changes, and stops the old one', () => {
    const { engine, context } = unlocked();
    engine.setLoop(sirenCue(0));
    const first = context.sources[0]!;

    engine.setLoop(sirenCue(3));
    const second = context.sources[1]!;

    expect(first.stoppedAt, 'the old loop was left running').not.toBeNull();
    // One ramp down, one ramp up: the two ends of the same cross-fade.
    const gains = context.gains.slice(1); // [0] is the master.
    expect(gains[0]!.gain.ramps.at(-1)?.to).toBe(0);
    expect(gains[1]!.gain.ramps.at(-1)?.to).toBe(1);
    expect(second.loop).toBe(true);
  });

  it('fades everything out when asked for no loop at all', () => {
    const { engine, context } = unlocked();
    engine.setLoop(sirenCue(0));
    engine.setLoop(null);

    expect(context.sources[0]!.stoppedAt).not.toBeNull();
    expect(context.sources).toHaveLength(1);
  });
});

describe('muting', () => {
  it('is a gain change, and nothing else', () => {
    const { engine, context } = unlocked();
    const master = context.gains[0]!;
    const opened = master.gain.value;
    expect(opened).toBeGreaterThan(0);

    engine.setMuted(true);
    expect(engine.isMuted).toBe(true);
    expect(master.gain.targets.at(-1)?.to).toBe(0);

    // The cue still plays; it is simply inaudible. Nothing about the game's
    // timing may depend on whether the player has sound on.
    engine.play(Cue.ChompA);
    expect(context.sources).toHaveLength(1);

    engine.setMuted(false);
    expect(master.gain.targets.at(-1)?.to).toBe(opened);
  });

  it('starts muted when the stored setting says so', () => {
    const engine = new AudioEngine(true);
    engine.unlock();
    expect(FakeContext.instances[0]!.gains[0]!.gain.value).toBe(0);
  });
});
