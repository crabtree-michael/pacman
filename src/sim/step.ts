import { moveGhost, movePacman } from './movement';
import { cloneState } from './state';
import { Direction, Phase, type GameState, type InputSnapshot } from './types';

/**
 * Advance the game by exactly one fixed tick.
 *
 * Pure: no DOM, no timers, no randomness beyond the seeded PRNG in the state.
 * The same `(state, input)` always produces the same result, which is what
 * makes replay tests — and, later, server-side score validation — possible
 * (architecture §1, §8.3).
 */
export function step(state: GameState, input: InputSnapshot, stepMs: number): GameState {
  const next = cloneState(state);

  switch (next.phase) {
    case Phase.Ready:
      next.phaseTimer -= stepMs;
      if (next.phaseTimer <= 0) {
        next.phase = Phase.Playing;
        next.phaseTimer = 0;
      }
      break;

    case Phase.Playing:
      applyInput(next, input);
      movePacman(next.maze.data, next.pacman, stepMs);
      for (const ghost of next.ghosts) {
        moveGhost(next.maze.data, ghost, stepMs);
      }
      // TODO(mechanics): pellet collection and scoring, power-pellet mode,
      // Pac-Man/ghost collisions, extra life at 10,000, level completion.
      break;

    case Phase.Attract:
    case Phase.Dying:
    case Phase.LevelComplete:
    case Phase.GameOver:
    case Phase.Paused:
      // TODO(mechanics): the remaining phases are timed cards and animations;
      // they land with the game-flow ticket. Holding here is correct until then.
      break;
  }

  return next;
}

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
