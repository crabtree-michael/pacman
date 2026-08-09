import { describe, expect, it } from 'vitest';
import { AudioDirector, loopFor, sirenTier, type CuePlayer } from '../../src/audio/director';
import { Cue, EYES_LOOP, FRIGHT_LOOP, SIREN_TIERS, sirenCue } from '../../src/audio/cues';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { createInitialState } from '../../src/sim/state';
import { GhostMode, Phase, type GameState } from '../../src/sim/types';

/**
 * The director is the whole of the audio system's decision-making, and it is
 * testable without a `AudioContext` in sight — which is the point of it taking
 * a `CuePlayer` rather than the engine.
 */

class Recorder implements CuePlayer {
  readonly played: string[] = [];
  readonly loops: (string | null)[] = [];

  play(name: string): void {
    this.played.push(name);
  }

  setLoop(name: string | null): void {
    this.loops.push(name);
  }

  get loop(): string | null {
    return this.loops.at(-1) ?? null;
  }
}

function playing(): GameState {
  const state = createInitialState(MAZE_CLASSIC);
  state.phase = Phase.Playing;
  return state;
}

describe('events become cues', () => {
  it('alternates the two chomp tones', () => {
    const player = new Recorder();
    const director = new AudioDirector(player);

    for (let i = 0; i < 4; i++) {
      const state = playing();
      state.events = [{ type: 'PelletEaten', x: 0, y: 0 }];
      director.update(state);
    }

    expect(player.played).toEqual([Cue.ChompA, Cue.ChompB, Cue.ChompA, Cue.ChompB]);
  });

  it('plays the cue each event asks for', () => {
    const player = new Recorder();
    const director = new AudioDirector(player);
    const state = playing();
    state.events = [
      { type: 'PowerPelletEaten', x: 0, y: 0 },
      { type: 'GhostEaten', name: 'blinky', points: 200 },
      { type: 'FruitEaten', kind: 'cherry', points: 100 },
      { type: 'ExtraLife' },
      { type: 'LevelCleared' },
      { type: 'Death' },
    ];

    director.update(state);

    expect(player.played).toEqual([
      Cue.PowerPellet,
      Cue.GhostEaten,
      Cue.FruitEaten,
      Cue.ExtraLife,
      Cue.LevelCleared,
      Cue.Death,
    ]);
  });

  it('shortens the jingle on a respawn and not on a fresh level', () => {
    const player = new Recorder();
    const director = new AudioDirector(player);

    const respawn = playing();
    respawn.events = [{ type: 'PhaseChanged', from: Phase.Dying, to: Phase.Ready }];
    director.update(respawn);

    const fresh = playing();
    fresh.events = [{ type: 'PhaseChanged', from: Phase.LevelComplete, to: Phase.Ready }];
    director.update(fresh);

    expect(player.played).toEqual([Cue.Respawn, Cue.Ready]);
  });

  /**
   * A 120 Hz panel renders each tick twice, and the loop can apply a phase
   * event outside the tick entirely. Both hand the director a state it may
   * already have seen; playing its events again would double every chomp.
   */
  it('plays a state’s events once, however often it is handed the same state', () => {
    const player = new Recorder();
    const director = new AudioDirector(player);
    const state = playing();
    state.events = [{ type: 'PelletEaten', x: 0, y: 0 }];

    director.update(state);
    director.update(state);
    director.update(state);

    expect(player.played).toEqual([Cue.ChompA]);
  });
});

describe('the loop that should be running', () => {
  it('is silent outside play, so the jingle and the death cue are heard', () => {
    for (const phase of [Phase.Boot, Phase.Attract, Phase.Ready, Phase.Dying, Phase.Paused]) {
      const state = playing();
      state.phase = phase;
      expect(loopFor(state), phase).toBeNull();
    }
  });

  it('puts eyes on their way home above the frightened warble', () => {
    const state = playing();
    state.fright = { active: true, msRemaining: 3000, ghostsEaten: 1 };
    expect(loopFor(state)).toBe(FRIGHT_LOOP);

    state.ghosts[0].mode = GhostMode.Eaten;
    expect(loopFor(state)).toBe(EYES_LOOP);
  });

  it('raises the siren as the board empties', () => {
    const state = playing();
    const total = state.maze.remaining;

    expect(sirenTier(state)).toBe(0);
    for (let tier = 0; tier < SIREN_TIERS; tier++) {
      state.dotsEaten = Math.floor((total * (tier + 0.5)) / SIREN_TIERS);
      state.maze.remaining = total - state.dotsEaten;
      expect(sirenTier(state), `${state.dotsEaten} of ${total} eaten`).toBe(tier);
    }

    // The last pellet must not run the tier off the end of the table.
    state.dotsEaten = total;
    state.maze.remaining = 0;
    expect(loopFor(state)).toBe(sirenCue(SIREN_TIERS - 1));
  });

  it('is restated every tick, which is what lets the engine ignore a repeat', () => {
    const player = new Recorder();
    const director = new AudioDirector(player);

    for (let i = 0; i < 3; i++) director.update(playing());

    expect(player.loops).toEqual([sirenCue(0), sirenCue(0), sirenCue(0)]);
  });
});
