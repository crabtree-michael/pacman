import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { tuningForLevel } from '../../src/sim/levels';
import { FRIGHT_FLASH_MS, isFrightFlashing } from '../../src/sim/modes';
import { GHOST_EATEN_FREEZE_MS } from '../../src/sim/pacman';
import { GHOST_POINTS } from '../../src/sim/scoring';
import { step } from '../../src/sim/step';
import {
  Direction,
  GhostMode,
  Phase,
  opposite,
  tileCentre,
  type GameState,
} from '../../src/sim/types';
import {
  IDLE,
  advance,
  advanceUntil,
  freezePacman,
  ghost,
  placeGhost,
  placePacman,
  playing,
} from './harness';

/**
 * Power pellets, the frightened timer, and what contact with a ghost costs
 * (product spec §4.3, §4.4, §4.5).
 *
 * The ghosts move for themselves now, so the cases that need one in a
 * particular place put it there and take the reading immediately: a ghost left
 * to its own devices for a hundred ticks is a test of the movement engine,
 * which is `ghosts.test.ts`'s job.
 */

const ROW = MAZE_CLASSIC.spawns.pacman.y;
/** Pac-Man's spawn tile: on the corridor under test, and empty of pellets. */
const BLANK_TILE = MAZE_CLASSIC.spawns.pacman.x;
const FRIGHT_TICKS = Math.round(6000 / STEP_MS);
const FREEZE_TICKS = Math.round(GHOST_EATEN_FREEZE_MS / STEP_MS);

/** Pac-Man two tiles from the bottom-left power pellet, Blinky loose behind. */
function approachingThePellet(level = 1): GameState {
  const state = placeGhost(playing(level), 'blinky', 6, ROW, GhostMode.Scatter, Direction.Left);
  return placePacman(state, 2, ROW, Direction.Left);
}

/** The pair of states either side of the tick the power pellet goes down. */
function acrossThePellet(level = 1): { before: GameState; after: GameState } {
  let before = approachingThePellet(level);

  for (let tick = 0; tick < 200; tick++) {
    const after = step(before, IDLE, STEP_MS);
    if (after.events.some((event) => event.type === 'PowerPelletEaten')) return { before, after };
    before = after;
  }

  throw new Error('the power pellet was never eaten');
}

/** A game one power pellet in, with Blinky loose and blue. */
function frightened(): GameState {
  return acrossThePellet().after;
}

describe('a power pellet', () => {
  it('turns the loose ghosts around and frightens them', () => {
    const { before, after } = acrossThePellet();

    expect(ghost(after, 'blinky').mode).toBe(GhostMode.Frightened);
    // Reversal is immediate, not at the next junction (product spec §4.3).
    expect(ghost(after, 'blinky').dir).toBe(opposite(ghost(before, 'blinky').dir));
  });

  it('leaves the ghosts behind the door alone', () => {
    // Waiting or walking out, they are not on the board, so the pellet does not
    // reach them — and one that emerges mid-pellet emerges dangerous.
    for (const name of ['pinky', 'inky', 'clyde'] as const) {
      const mode = ghost(frightened(), name).mode;
      expect([GhostMode.House, GhostMode.Leaving]).toContain(mode);
    }
  });

  it('runs for exactly the level’s frightened time, then hands the board back', () => {
    const state = frightened();

    const last = advance(state, FRIGHT_TICKS - 1);
    expect(last.fright.active).toBe(true);
    expect(ghost(last, 'blinky').mode).toBe(GhostMode.Frightened);

    const over = advance(last, 1);
    expect(over.fright.active).toBe(false);
    expect(over.fright.msRemaining).toBe(0);
    // Back to whatever the global cursor says, which seven seconds in is still
    // the opening scatter.
    expect(ghost(over, 'blinky').mode).toBe(GhostMode.Scatter);
  });

  it('flashes a warning before it expires', () => {
    const state = frightened();
    expect(isFrightFlashing(state)).toBe(false);

    const flashing = advance(state, Math.round((6000 - FRIGHT_FLASH_MS) / STEP_MS));
    expect(isFrightFlashing(flashing)).toBe(true);
  });

  it('restarts rather than extends when a second one is eaten', () => {
    // Halfway through the first, with one ghost already banked.
    const halfway = advance(frightened(), FRIGHT_TICKS / 2);
    const midChain: GameState = {
      ...halfway,
      fright: { ...halfway.fright, ghostsEaten: 2 },
    };

    const second = advanceUntil(
      placePacman(midChain, 2, 3, Direction.Left),
      (s) => s.fright.msRemaining > halfway.fright.msRemaining,
      'the second power pellet',
    );

    expect(second.fright.msRemaining).toBe(6000);
    // The multiplier starts over with the new pellet (product spec §4.4).
    expect(second.fright.ghostsEaten).toBe(0);
  });

  it('stops frightening anyone from level 19', () => {
    expect(tuningForLevel(19).frightMs).toBe(0);
    const { before, after } = acrossThePellet(19);

    expect(after.fright.active).toBe(false);
    // The ghosts still turn around; the pellet's reversal is not the mode's.
    expect(ghost(after, 'blinky').mode).toBe(GhostMode.Scatter);
    expect(ghost(after, 'blinky').dir).toBe(opposite(ghost(before, 'blinky').dir));
  });
});

describe('eating a ghost', () => {
  it('pays the 200/400/800/1600 ladder and sends it home as eyes', () => {
    // Pac-Man held on his own spawn tile, which carries no pellet: the only
    // thing that can score here is a ghost.
    let state = freezePacman(placePacman(frightened(), BLANK_TILE, ROW));
    const before = state.score;

    // The same ghost four times over: the ladder counts how many have been
    // eaten under this pellet, not which ones.
    for (const [index, points] of GHOST_POINTS.entries()) {
      state = placeGhost(state, 'blinky', BLANK_TILE, ROW, GhostMode.Frightened);
      state = advance(state, 1);

      expect(ghost(state, 'blinky').mode).toBe(GhostMode.Eaten);
      expect(state.fright.ghostsEaten).toBe(index + 1);
      expect(state.events).toContainEqual({ type: 'GhostEaten', name: 'blinky', points });

      state = advanceUntil(state, (s) => s.freezeMs === 0, 'the score bubble to clear');
    }

    expect(state.score - before).toBe(200 + 400 + 800 + 1600);
  });

  it('holds the whole board still while the score shows', () => {
    const eaten = advance(
      placeGhost(placePacman(frightened(), BLANK_TILE, ROW), 'blinky', BLANK_TILE, ROW, GhostMode.Frightened),
      1,
    );
    expect(eaten.freezeMs).toBe(GHOST_EATEN_FREEZE_MS);

    const during = advance(eaten, FREEZE_TICKS - 1);
    expect(during.pacman.x).toBe(eaten.pacman.x);
    expect(ghost(during, 'pinky').y).toBe(ghost(eaten, 'pinky').y);
    // The frightened clock stops too, or the freeze would be a second of the
    // player's power pellet spent watching a number.
    expect(during.fright.msRemaining).toBe(eaten.fright.msRemaining);

    const moving = advance(during, 2);
    expect(moving.freezeMs).toBe(0);
    expect(moving.pacman.x).not.toBe(eaten.pacman.x);
  });

  it('is not contact once it is a pair of eyes', () => {
    const eyes = placeGhost(
      placePacman(frightened(), BLANK_TILE, ROW),
      'blinky',
      BLANK_TILE,
      ROW,
      GhostMode.Eaten,
    );
    expect(advance(eyes, 1).phase).toBe(Phase.Playing);
  });
});

describe('contact with a ghost that is not frightened', () => {
  /** Blinky in Pac-Man's path, three tiles ahead of his spawn. */
  function inThePath(state = playing()): GameState {
    return placeGhost(state, 'blinky', 12, ROW, GhostMode.Chase);
  }

  it('costs a life and runs the death phase', () => {
    const caught = advanceUntil(
      inThePath(),
      (s) => s.phase !== Phase.Playing,
      'the collision',
    );

    expect(caught.phase).toBe(Phase.Dying);
    expect(caught.lives).toBe(2);
    expect(caught.events).toContainEqual({ type: 'Death' });
  });

  it('respawns with the board as it was left', () => {
    const caught = advanceUntil(inThePath(), (s) => s.phase === Phase.Dying, 'the collision');
    const respawned = advanceUntil(caught, (s) => s.phase === Phase.Ready, 'the respawn');

    expect(respawned.maze.remaining).toBe(caught.maze.remaining);
    expect(respawned.pacman.x).toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.x));
    expect(respawned.fright.active).toBe(false);
    expect(respawned.fruit).toBeNull();
  });

  it('ends the game on the last life', () => {
    const caught = advanceUntil(
      inThePath({ ...playing(), lives: 1 }),
      (s) => s.phase === Phase.Dying,
      'the collision',
    );

    expect(caught.lives).toBe(0);
    expect(advanceUntil(caught, (s) => s.phase !== Phase.Dying).phase).toBe(Phase.GameOver);
  });
});
