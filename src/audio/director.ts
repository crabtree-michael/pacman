import { GhostMode, Phase, type GameEvent, type GameState } from '../sim/types';
import { Cue, EYES_LOOP, FRIGHT_LOOP, SIREN_TIERS, sirenCue } from './cues';

/**
 * Events and state in, cues out (architecture §5.2).
 *
 * The director is a pure consumer: it reads `state.events` and a little derived
 * state, and it never calls back into the simulation. That is the whole reason
 * the sim pushes events onto a queue instead of calling a sound function — with
 * this shape, muting, or dropping the audio subsystem entirely, cannot change
 * what happens on the board.
 *
 * It takes a `CuePlayer` rather than the engine so it can be tested against a
 * recording double, with no `AudioContext` in sight.
 */

export interface CuePlayer {
  play(name: string): void;
  /** The looping cue that should be running, or `null` for none. */
  setLoop(name: string | null): void;
}

export class AudioDirector {
  private readonly player: CuePlayer;
  /** The state whose events have already been played. */
  private lastState: GameState | null = null;
  /** The chomp alternates two tones (product spec §4.7). */
  private chompFlip = false;

  constructor(player: CuePlayer) {
    this.player = player;
  }

  /**
   * Called once per simulation tick, and once per phase event applied outside
   * the loop. Guarded on the state identity so a state whose events have been
   * played cannot be played again.
   */
  update(state: GameState): void {
    if (state === this.lastState) return;
    this.lastState = state;

    for (const event of state.events) this.handle(event);
    this.player.setLoop(loopFor(state));
  }

  private handle(event: GameEvent): void {
    switch (event.type) {
      case 'PelletEaten':
        this.chompFlip = !this.chompFlip;
        this.player.play(this.chompFlip ? Cue.ChompA : Cue.ChompB);
        return;
      case 'PowerPelletEaten':
        this.player.play(Cue.PowerPellet);
        return;
      case 'GhostEaten':
        this.player.play(Cue.GhostEaten);
        return;
      case 'FruitEaten':
        this.player.play(Cue.FruitEaten);
        return;
      case 'ExtraLife':
        this.player.play(Cue.ExtraLife);
        return;
      case 'Death':
        this.player.play(Cue.Death);
        return;
      case 'LevelCleared':
        this.player.play(Cue.LevelCleared);
        return;
      case 'PhaseChanged':
        // A respawn gets the short jingle, a fresh level the full one — the
        // arcade shortens it in the same place, and the countdown is the same
        // three seconds either way.
        if (event.to === Phase.Ready) {
          this.player.play(event.from === Phase.Dying ? Cue.Respawn : Cue.Ready);
        }
        return;
      case 'FruitAppeared':
        return;
    }
  }
}

/**
 * Which loop belongs to this moment.
 *
 * Order matters: eyes on their way home outrank the frightened warble, because
 * a ghost that has already been eaten is the thing the player is tracking.
 * Everything outside `Playing` is silent, which is what makes the Ready jingle
 * and the death cue audible against nothing.
 */
export function loopFor(state: GameState): string | null {
  if (state.phase !== Phase.Playing) return null;
  if (state.ghosts.some((ghost) => ghost.mode === GhostMode.Eaten)) return EYES_LOOP;
  if (state.fright.active) return FRIGHT_LOOP;
  return sirenCue(sirenTier(state));
}

/**
 * The siren rises as the board empties (product spec §4.7).
 *
 * The total is the two counters added rather than a constant: a second maze
 * layout with a different pellet count would otherwise pin the siren to its
 * lowest tier for the whole level.
 */
export function sirenTier(state: GameState): number {
  const total = state.dotsEaten + state.maze.remaining;
  if (total <= 0) return SIREN_TIERS - 1;
  const eaten = state.dotsEaten / total;
  return Math.min(SIREN_TIERS - 1, Math.floor(eaten * SIREN_TIERS));
}
