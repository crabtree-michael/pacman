import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { tuningForLevel } from '../../src/sim/levels';
import { FRIGHT_FLASH_MS, isFrightFlashing } from '../../src/sim/modes';
import { GHOST_POINTS } from '../../src/sim/scoring';
import {
  Direction,
  GhostMode,
  Phase,
  tileCentre,
  type GameState,
  type GhostState,
} from '../../src/sim/types';
import { advance, advanceUntil, placePacman, playing } from './harness';

/**
 * Power pellets, the frightened timer, and what contact with a ghost costs
 * (product spec §4.3, §4.4, §4.5).
 *
 * Ghosts do not move yet — that is the ghost ticket — so these place them by
 * hand. The mechanics under test are the player's half: what a power pellet
 * does to the board, what eating a ghost is worth, and what touching one costs.
 */

const ROW = MAZE_CLASSIC.spawns.pacman.y;
/** Pac-Man's spawn tile: on the corridor under test, and empty of pellets. */
const BLANK_TILE = MAZE_CLASSIC.spawns.pacman.x;
const FRIGHT_TICKS = Math.round(6000 / STEP_MS);

/** Put `blinky` on a tile in whatever mode the case needs. */
function withBlinkyAt(
  state: GameState,
  col: number,
  row: number,
  mode: GhostMode,
  dir: Direction = Direction.Left,
): GameState {
  const [blinky, ...rest] = state.ghosts;
  const placed: GhostState = { ...blinky, x: tileCentre(col), y: tileCentre(row), dir, mode };
  return { ...state, ghosts: [placed, ...rest] as unknown as GameState['ghosts'] };
}

/** A game one power pellet in, with Blinky loose in the corridor ahead. */
function frightened(): GameState {
  const start = withBlinkyAt(playing(), 6, ROW, GhostMode.Scatter, Direction.Left);
  return advanceUntil(
    placePacman(start, 2, ROW, Direction.Left),
    (s) => s.fright.active,
    'the power pellet',
  );
}

describe('a power pellet', () => {
  it('turns the loose ghosts around and frightens them', () => {
    const state = frightened();
    const blinky = state.ghosts[0];

    expect(blinky.mode).toBe(GhostMode.Frightened);
    // Reversal is immediate, not at the next junction (product spec §4.3).
    expect(blinky.dir).toBe(Direction.Right);
  });

  it('leaves ghosts in the house alone', () => {
    const state = frightened();
    for (const ghost of state.ghosts.slice(1)) {
      expect(ghost.mode).toBe(GhostMode.House);
    }
  });

  it('runs for exactly the level’s frightened time, then hands the board back', () => {
    const state = frightened();

    const last = advance(state, FRIGHT_TICKS - 1);
    expect(last.fright.active).toBe(true);
    expect(last.ghosts[0].mode).toBe(GhostMode.Frightened);

    const over = advance(last, 1);
    expect(over.fright.active).toBe(false);
    expect(over.fright.msRemaining).toBe(0);
    expect(over.ghosts[0].mode).toBe(GhostMode.Scatter);
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
    const state = { ...playing(19), level: 19 };
    expect(tuningForLevel(19).frightMs).toBe(0);

    const eaten = advanceUntil(
      withBlinkyAt(placePacman(state, 2, ROW, Direction.Left), 6, ROW, GhostMode.Scatter),
      (s) => s.events.some((event) => event.type === 'PowerPelletEaten'),
      'the power pellet',
    );

    expect(eaten.fright.active).toBe(false);
    // The ghosts still turn around; the pellet's reversal is not the mode's.
    expect(eaten.ghosts[0].mode).toBe(GhostMode.Scatter);
    expect(eaten.ghosts[0].dir).toBe(Direction.Right);
  });
});

describe('eating a ghost', () => {
  it('pays the 200/400/800/1600 ladder and sends it home as eyes', () => {
    let state = frightened();
    const before = state.score;

    // The same ghost four times over: the ladder counts how many have been
    // eaten under this pellet, not which ones. They meet on Pac-Man's own
    // spawn tile, which carries no pellet, so nothing but ghosts scores here.
    for (const [index, points] of GHOST_POINTS.entries()) {
      state = withBlinkyAt(state, BLANK_TILE, ROW, GhostMode.Frightened);
      // Stand the ghost on Pac-Man rather than the reverse: the tile is what
      // counts, not who arrived first.
      state = {
        ...state,
        pacman: { ...state.pacman, x: tileCentre(BLANK_TILE), y: tileCentre(ROW) },
      };
      state = advance(state, 1);

      expect(state.ghosts[0].mode).toBe(GhostMode.Eaten);
      expect(state.fright.ghostsEaten).toBe(index + 1);
      expect(state.events).toContainEqual({ type: 'GhostEaten', name: 'blinky', points });

      // Reset the ghost for the next rung of the ladder.
      state = withBlinkyAt(state, 6, ROW, GhostMode.Frightened);
    }

    expect(state.score - before).toBe(200 + 400 + 800 + 1600);
  });

  it('is not contact once it is a pair of eyes', () => {
    const eyes = withBlinkyAt(frightened(), BLANK_TILE, ROW, GhostMode.Eaten);
    const walked = advance(
      {
        ...eyes,
        pacman: { ...eyes.pacman, x: tileCentre(BLANK_TILE), y: tileCentre(ROW) },
      },
      1,
    );
    expect(walked.phase).toBe(Phase.Playing);
  });
});

describe('contact with a ghost that is not frightened', () => {
  it('costs a life and runs the death phase', () => {
    const caught = advanceUntil(
      withBlinkyAt(playing(), 12, ROW, GhostMode.Chase),
      (s) => s.phase !== Phase.Playing,
      'the collision',
    );

    expect(caught.phase).toBe(Phase.Dying);
    expect(caught.lives).toBe(2);
    expect(caught.events).toContainEqual({ type: 'Death' });
  });

  it('respawns with the board as it was left', () => {
    const caught = advanceUntil(
      withBlinkyAt(playing(), 12, ROW, GhostMode.Chase),
      (s) => s.phase === Phase.Dying,
      'the collision',
    );
    const respawned = advanceUntil(caught, (s) => s.phase === Phase.Ready, 'the respawn');

    expect(respawned.maze.remaining).toBe(caught.maze.remaining);
    expect(respawned.pacman.x).toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.x));
    expect(respawned.fright.active).toBe(false);
    expect(respawned.fruit).toBeNull();
  });

  it('ends the game on the last life', () => {
    const onLastLife: GameState = { ...playing(), lives: 1 };
    const caught = advanceUntil(
      withBlinkyAt(onLastLife, 12, ROW, GhostMode.Chase),
      (s) => s.phase === Phase.Dying,
      'the collision',
    );

    expect(caught.lives).toBe(0);
    expect(advanceUntil(caught, (s) => s.phase !== Phase.Dying).phase).toBe(Phase.GameOver);
  });
});
