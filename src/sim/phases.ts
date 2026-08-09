import { updateFruit } from './fruit';
import { updateFright } from './modes';
import { moveGhost } from './movement';
import { resolveGhostContact, updatePacman } from './pacman';
import { cloneState, resetActors, resetGame, startLevel } from './state';
import { Direction, Phase, type GameState, type InputSnapshot } from './types';

/**
 * The game-flow state machine (architecture §3.3, product spec §4.6).
 *
 * Flow: `Boot → Attract → Ready → Playing → {Dying → Ready | LevelComplete →
 * Ready | GameOver → Attract}`, with `Paused` suspending whatever is underneath
 * it. There is no "won the game" state — from level 21 the tuning table clamps
 * and play continues, matching the arcade (product spec §4.5).
 *
 * Two pieces, exactly as the architecture specifies: a static table of
 * `(phase, event) → phase`, and per-phase `enter`/`update`/`exit` handlers. The
 * split is what keeps the flow readable — the table is the whole story of what
 * can happen next, and no handler is allowed to assign `state.phase` itself.
 *
 * Phases like `Ready` and `Dying` do nothing but tick a clock, which is how the
 * arcade's freeze frames fall out for free.
 */

/** Countdown before play begins (product spec §4.6). */
export const READY_MS = 3000;
/** The death animation's freeze, before respawn or game over. */
export const DYING_MS = 1600;
/** The "LEVEL n" card between mazes (product spec §2.3). */
export const LEVEL_COMPLETE_MS = 2000;
/** How long GAME OVER holds before the attract screen takes over. */
export const GAME_OVER_MS = 4000;

export const PhaseEvent = {
  /** Assets have decoded; the boot gate opens (architecture §5.3). */
  AssetsReady: 'AssetsReady',
  /** The player asked to play — the attract screen's TAP TO PLAY target. */
  StartRequested: 'StartRequested',
  CountdownElapsed: 'CountdownElapsed',
  /** A ghost caught Pac-Man. */
  PacmanCaught: 'PacmanCaught',
  /** The last pellet went. */
  BoardCleared: 'BoardCleared',
  /** The death freeze ended and there is still a life left. */
  DeathAnimationDone: 'DeathAnimationDone',
  /** The death freeze ended on the last life. */
  LivesExhausted: 'LivesExhausted',
  LevelCardDone: 'LevelCardDone',
  AttractRequested: 'AttractRequested',
  PauseRequested: 'PauseRequested',
  ResumeRequested: 'ResumeRequested',
  RestartRequested: 'RestartRequested',
} as const;
export type PhaseEvent = (typeof PhaseEvent)[keyof typeof PhaseEvent];

/**
 * Transition target meaning "whatever `Paused` is sitting on top of".
 *
 * The one dynamic entry in an otherwise static table; resolving it in `dispatch`
 * keeps the table a plain lookup rather than a set of predicates.
 */
const RESUME = '@resume';

type Target = Phase | typeof RESUME;

/**
 * `(phase, event) → phase`. A pair that is absent is not an error — it is an
 * event that does not apply here, and `dispatch` ignores it. That totality is
 * what lets the app fire `PauseRequested` on every `visibilitychange` without
 * first asking what phase the game is in.
 */
const TRANSITIONS: Readonly<Partial<Record<Phase, Readonly<Partial<Record<PhaseEvent, Target>>>>>> =
  {
    [Phase.Boot]: {
      [PhaseEvent.AssetsReady]: Phase.Attract,
    },
    [Phase.Attract]: {
      [PhaseEvent.StartRequested]: Phase.Ready,
    },
    [Phase.Ready]: {
      [PhaseEvent.CountdownElapsed]: Phase.Playing,
      [PhaseEvent.PauseRequested]: Phase.Paused,
    },
    [Phase.Playing]: {
      [PhaseEvent.PacmanCaught]: Phase.Dying,
      [PhaseEvent.BoardCleared]: Phase.LevelComplete,
      [PhaseEvent.PauseRequested]: Phase.Paused,
    },
    [Phase.Dying]: {
      [PhaseEvent.DeathAnimationDone]: Phase.Ready,
      [PhaseEvent.LivesExhausted]: Phase.GameOver,
      [PhaseEvent.PauseRequested]: Phase.Paused,
    },
    [Phase.LevelComplete]: {
      [PhaseEvent.LevelCardDone]: Phase.Ready,
      [PhaseEvent.PauseRequested]: Phase.Paused,
    },
    [Phase.GameOver]: {
      [PhaseEvent.AttractRequested]: Phase.Attract,
      [PhaseEvent.RestartRequested]: Phase.Ready,
    },
    [Phase.Paused]: {
      [PhaseEvent.ResumeRequested]: RESUME,
      [PhaseEvent.RestartRequested]: Phase.Ready,
    },
  };

interface PhaseHandlers {
  /** Runs once on arrival. `cause` is the event that caused the transition. */
  enter?(state: GameState, cause: PhaseEvent): void;
  /** Runs once per simulation tick. Returns the event it wants dispatched. */
  update?(state: GameState, input: InputSnapshot, stepMs: number): PhaseEvent | null;
  /** Runs once on departure. */
  exit?(state: GameState, cause: PhaseEvent): void;
}

/**
 * Tick a phase clock down; true once it has run out.
 *
 * The `stepMs / 1000` slack is not cosmetic. Subtracting 1000/60 from 3000 one
 * hundred and eighty times leaves +5e-12 behind rather than 0, so a plain
 * `> 0` test would stretch a 3-second countdown to 181 ticks — and every
 * duration that divides evenly into the tick would be one tick long. A
 * thousandth of a tick sits far above the accumulated error of a double and far
 * below anything a player could perceive, and being plain float arithmetic it
 * stays bit-identical across devices, which is what replays depend on.
 */
function countdown(state: GameState, stepMs: number): boolean {
  state.phaseTimer -= stepMs;
  if (state.phaseTimer > stepMs / 1000) return false;
  state.phaseTimer = 0;
  return true;
}

const HANDLERS: Readonly<Record<Phase, PhaseHandlers>> = {
  [Phase.Boot]: {
    // Waits for `AssetsReady`. Nothing may move before the atlas has decoded,
    // or the first frame of play would be drawn with missing sprites.
  },

  [Phase.Attract]: {
    // TODO(ui): the attract screen runs a demo of the maze behind the title
    // (product spec §2.3). It is a ghost-AI-driven display, so it lands with
    // that ticket; until then the phase is inert and the app starts the game.
  },

  [Phase.Ready]: {
    enter(state, cause) {
      switch (cause) {
        case PhaseEvent.StartRequested:
        case PhaseEvent.RestartRequested:
          resetGame(state);
          break;
        case PhaseEvent.LevelCardDone:
          startLevel(state, state.level + 1);
          break;
        default:
          // A respawn after death: the board keeps its eaten pellets.
          resetActors(state);
      }
      state.phaseTimer = READY_MS;
    },
    update(state, _input, stepMs) {
      return countdown(state, stepMs) ? PhaseEvent.CountdownElapsed : null;
    },
  },

  [Phase.Playing]: {
    update(state, input, stepMs) {
      applyInput(state, input);
      // The two clocks tick before anything eats, so a power pellet or a fruit
      // taken on this tick gets its full duration rather than 16 ms less — the
      // same "enter now, update next tick" rule the phase clocks follow.
      updateFright(state, stepMs);
      updateFruit(state, stepMs);

      updatePacman(state, stepMs);
      for (const ghost of state.ghosts) {
        moveGhost(state.maze.data, ghost, stepMs);
      }

      // Contact is resolved after both sides have moved, so a ghost that walks
      // onto Pac-Man and one Pac-Man walks onto are the same event.
      if (resolveGhostContact(state)) return PhaseEvent.PacmanCaught;
      // `<= 0` rather than `=== 0`: a test or a future mechanic that empties
      // the board by hand should still end the level on the next tick.
      if (state.maze.remaining <= 0) return PhaseEvent.BoardCleared;
      return null;
    },
  },

  [Phase.Dying]: {
    enter(state) {
      state.lives = Math.max(0, state.lives - 1);
      state.phaseTimer = DYING_MS;
      state.events.push({ type: 'Death' });
    },
    update(state, _input, stepMs) {
      if (!countdown(state, stepMs)) return null;
      return state.lives > 0 ? PhaseEvent.DeathAnimationDone : PhaseEvent.LivesExhausted;
    },
  },

  [Phase.LevelComplete]: {
    enter(state) {
      state.phaseTimer = LEVEL_COMPLETE_MS;
      state.events.push({ type: 'LevelCleared' });
    },
    update(state, _input, stepMs) {
      return countdown(state, stepMs) ? PhaseEvent.LevelCardDone : null;
    },
  },

  [Phase.GameOver]: {
    enter(state) {
      state.phaseTimer = GAME_OVER_MS;
    },
    update(state, _input, stepMs) {
      return countdown(state, stepMs) ? PhaseEvent.AttractRequested : null;
    },
  },

  [Phase.Paused]: {
    // No update: a paused game does not tick. Because the simulation is a pure
    // function of its state, that is the entire implementation of pause — no
    // clocks to freeze, no timers to cancel (architecture §1).
  },
};

/**
 * Arm the turn buffer from the latest input intent.
 *
 * Only a *new* intent re-arms it. A direction the player holds latched would
 * otherwise reset the 400 ms expiry every tick, so a request that never became
 * legal could never expire.
 */
function applyInput(state: GameState, input: InputSnapshot): void {
  if (input.serial === state.lastInputSerial) return;
  state.lastInputSerial = input.serial;
  if (input.dir === Direction.None) return;
  state.pacman.pendingDir = input.dir;
  state.pacman.pendingAge = 0;
}

/**
 * Apply one event to `state` in place. Returns false if the event does not
 * apply to the current phase, in which case nothing was touched.
 *
 * Mutating is deliberate: `step` and `applyPhaseEvent` both call this on a
 * clone they own, which keeps the simulation pure at its boundary without
 * making every handler write in an immutable style.
 */
export function dispatch(state: GameState, event: PhaseEvent): boolean {
  const target = TRANSITIONS[state.phase]?.[event];
  if (target === undefined) return false;

  const from = state.phase;
  const to = target === RESUME ? state.resumePhase : target;
  if (to === from) return false;

  /**
   * Pause *suspends* the phase underneath rather than replacing it, so neither
   * side runs its exit/enter handlers. Without this, pausing during the
   * countdown and resuming would re-enter `Ready` — restarting the countdown
   * and teleporting everyone back to their spawn tiles.
   *
   * `RestartRequested` out of `Paused` is not suspending, and does run
   * `Ready.enter`, which is exactly what makes it a restart.
   */
  const suspending =
    event === PhaseEvent.PauseRequested || event === PhaseEvent.ResumeRequested;

  if (!suspending) HANDLERS[from].exit?.(state, event);
  if (to === Phase.Paused) state.resumePhase = from;
  state.phase = to;
  if (!suspending) HANDLERS[to].enter?.(state, event);

  state.events.push({ type: 'PhaseChanged', from, to });
  return true;
}

/**
 * Advance the current phase by one tick and dispatch whatever it asks for.
 *
 * At most one transition per tick: a handler's `enter` runs on the tick it
 * arrives, and its `update` starts on the next one. That is what makes the
 * timed phases exact — `Ready` is 180 ticks, not 179 or 181.
 */
export function updatePhase(state: GameState, input: InputSnapshot, stepMs: number): void {
  const event = HANDLERS[state.phase].update?.(state, input, stepMs) ?? null;
  if (event) dispatch(state, event);
}

/**
 * Apply an event from outside the tick loop — the pause button, the boot gate,
 * a backgrounded tab.
 *
 * Returns the original state untouched when the event does not apply, so a
 * caller can cheaply tell whether anything happened.
 */
export function applyPhaseEvent(state: GameState, event: PhaseEvent): GameState {
  const next = cloneState(state);
  if (!dispatch(next, event)) return state;
  return next;
}
