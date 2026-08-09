import type { CueDef } from './synth';

/**
 * The cue table (product spec §4.7).
 *
 * One entry per sound the game can make. Everything is square and triangle
 * waves with pitch sweeps, which is what the original's sound chip could do and
 * why the game's audio is recognisable from two notes.
 *
 * Loops are marked; the engine cross-fades between them as the state of play
 * changes, and never restarts one that is already running.
 */

export const Cue = {
  ChompA: 'chomp-a',
  ChompB: 'chomp-b',
  PowerPellet: 'power-pellet',
  GhostEaten: 'ghost-eaten',
  FruitEaten: 'fruit-eaten',
  ExtraLife: 'extra-life',
  Death: 'death',
  LevelCleared: 'level-cleared',
  /** The full jingle at the start of a level. */
  Ready: 'ready',
  /** The short version after a death, where the arcade also shortens it. */
  Respawn: 'respawn',
} as const;
export type Cue = (typeof Cue)[keyof typeof Cue];

/** The siren, one loop per tier; the pitch rises as the board empties. */
export const SIREN_TIERS = 5;

export function sirenCue(tier: number): string {
  return `siren-${tier}`;
}

export const FRIGHT_LOOP = 'fright';
export const EYES_LOOP = 'eyes';

/**
 * The siren: a rising sweep and a fall back, looped. Each tier is the same
 * shape a little higher and a little faster, so an emptying board raises the
 * tension without ever changing what the sound *is*.
 */
function siren(tier: number): CueDef {
  const base = 180 + tier * 34;
  const ms = 420 - tier * 45;
  return {
    loop: true,
    segments: [
      { wave: 'triangle', from: base, to: base * 1.5, ms: ms / 2, gain: 0.5 },
      { wave: 'triangle', from: base * 1.5, to: base, ms: ms / 2, gain: 0.5 },
    ],
  };
}

const CUE_TABLE: Record<string, CueDef> = {
  // Two alternating blips: the chomp is a texture rather than a note, and one
  // tone repeated 60 times a maze reads as a stuck sound effect.
  [Cue.ChompA]: {
    segments: [{ wave: 'square', from: 440, to: 180, ms: 55, gain: 0.35 }],
  },
  [Cue.ChompB]: {
    segments: [{ wave: 'square', from: 180, to: 440, ms: 55, gain: 0.35 }],
  },

  [Cue.PowerPellet]: {
    segments: [
      { wave: 'square', from: 160, to: 520, ms: 90, gain: 0.4 },
      { wave: 'square', from: 520, to: 200, ms: 90, gain: 0.4 },
      { wave: 'square', from: 200, to: 620, ms: 110, gain: 0.4 },
    ],
  },

  [Cue.GhostEaten]: {
    segments: [
      { wave: 'saw', from: 240, to: 900, ms: 160, gain: 0.4 },
      { wave: 'saw', from: 900, to: 1400, ms: 120, gain: 0.35 },
    ],
  },

  [Cue.FruitEaten]: {
    segments: [
      { wave: 'triangle', from: 700, ms: 70, gain: 0.45 },
      { wave: 'triangle', from: 950, ms: 70, gain: 0.45 },
      { wave: 'triangle', from: 1300, ms: 120, gain: 0.4 },
    ],
  },

  [Cue.ExtraLife]: {
    segments: [
      { wave: 'square', from: 880, ms: 90, gain: 0.4 },
      { wave: 'square', from: 1174, ms: 90, gain: 0.4 },
      { wave: 'square', from: 1568, ms: 200, gain: 0.4 },
    ],
  },

  // The death: a long fall, with the sound thinning out as it goes.
  [Cue.Death]: {
    segments: [
      { wave: 'square', from: 620, to: 480, ms: 140, gain: 0.45 },
      { wave: 'square', from: 520, to: 380, ms: 140, gain: 0.42 },
      { wave: 'square', from: 420, to: 280, ms: 160, gain: 0.38 },
      { wave: 'square', from: 320, to: 180, ms: 180, gain: 0.34 },
      { wave: 'triangle', from: 200, to: 70, ms: 320, gain: 0.3 },
      { wave: 'noise', from: 60, ms: 120, gain: 0.12 },
    ],
  },

  [Cue.LevelCleared]: {
    segments: [
      { wave: 'triangle', from: 523, ms: 110, gain: 0.4 },
      { wave: 'triangle', from: 659, ms: 110, gain: 0.4 },
      { wave: 'triangle', from: 784, ms: 110, gain: 0.4 },
      { wave: 'triangle', from: 1047, ms: 260, gain: 0.4 },
    ],
  },

  // The intro jingle, sized to sit inside the 3 s Ready countdown.
  [Cue.Ready]: {
    segments: [
      { wave: 'square', from: 523, ms: 150, gain: 0.35 },
      { wave: 'square', from: 784, ms: 150, gain: 0.35 },
      { wave: 'square', from: 659, ms: 150, gain: 0.35 },
      { wave: 'square', from: 587, ms: 150, gain: 0.35 },
      { wave: 'square', from: 523, ms: 150, gain: 0.35 },
      { wave: 'square', from: 784, ms: 300, gain: 0.35 },
      { wave: 'square', from: 1047, ms: 400, gain: 0.32 },
    ],
  },

  [Cue.Respawn]: {
    segments: [
      { wave: 'square', from: 523, ms: 130, gain: 0.35 },
      { wave: 'square', from: 784, ms: 130, gain: 0.35 },
      { wave: 'square', from: 1047, ms: 260, gain: 0.32 },
    ],
  },

  // Frightened: a fast, unsettled warble, deliberately lower than the siren so
  // the change of state is obvious even at low volume.
  [FRIGHT_LOOP]: {
    loop: true,
    segments: [
      { wave: 'square', from: 130, to: 200, ms: 90, gain: 0.3 },
      { wave: 'square', from: 200, to: 130, ms: 90, gain: 0.3 },
    ],
  },

  // Eyes returning home: thin, high and quick.
  [EYES_LOOP]: {
    loop: true,
    segments: [
      { wave: 'sine', from: 1200, to: 1600, ms: 70, gain: 0.22 },
      { wave: 'sine', from: 1600, to: 1200, ms: 70, gain: 0.22 },
    ],
  },
};

for (let tier = 0; tier < SIREN_TIERS; tier++) {
  CUE_TABLE[sirenCue(tier)] = siren(tier);
}

export const CUES: Readonly<Record<string, CueDef>> = CUE_TABLE;
