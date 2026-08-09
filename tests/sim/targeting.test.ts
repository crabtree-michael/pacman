import { describe, expect, it } from 'vitest';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import {
  CLYDE_RADIUS,
  chaseTarget,
  elroyStage,
  scatterTarget,
  targetTile,
} from '../../src/sim/ghosts/targeting';
import { tuningForLevel } from '../../src/sim/levels';
import { Direction, GhostMode, type GameState, type Tile } from '../../src/sim/types';
import { ghost, placeGhost, placePacman, playing } from './harness';

/**
 * The four personalities (product spec §4.3, architecture §9 "Targeting
 * rules": a board state in, a target tile out).
 *
 * These call the targeting functions directly rather than driving the game,
 * because a target tile is a *statement about a position*, not about a route:
 * asserting where Pinky is aiming is exact, while asserting where she ends up
 * is a test of the movement engine wearing a targeting test's clothes.
 */

/** Pac-Man in open board, away from the house, facing `dir`. */
function board(col: number, row: number, dir: Direction): GameState {
  return placePacman(playing(), col, row, dir);
}

const PAC: Tile = { col: 10, row: 20 };

describe('Blinky', () => {
  it('aims at the tile Pac-Man is standing on', () => {
    const state = board(PAC.col, PAC.row, Direction.Left);
    expect(chaseTarget(state, 'blinky')).toEqual(PAC);
  });
});

describe('Pinky', () => {
  const cases: ReadonlyArray<[string, Direction, Tile]> = [
    ['left', Direction.Left, { col: 6, row: 20 }],
    ['right', Direction.Right, { col: 14, row: 20 }],
    ['down', Direction.Down, { col: 10, row: 24 }],
  ];

  for (const [name, dir, target] of cases) {
    it(`aims four tiles ${name} of Pac-Man`, () => {
      expect(chaseTarget(board(PAC.col, PAC.row, dir), 'pinky')).toEqual(target);
    });
  }

  it('aims four up and four left when Pac-Man faces up, bug and all', () => {
    // The arcade's 8-bit overflow, which the spec asks for by name (§4.3).
    // Without it, turning up into Pinky would not shake her.
    expect(chaseTarget(board(PAC.col, PAC.row, Direction.Up), 'pinky')).toEqual({
      col: 6,
      row: 16,
    });
  });
});

describe('Inky', () => {
  it('doubles the vector from Blinky to two tiles ahead of Pac-Man', () => {
    // Pivot is (8, 20); Blinky sits four tiles the other side of it.
    const state = placeGhost(
      board(PAC.col, PAC.row, Direction.Left),
      'blinky',
      12,
      20,
      GhostMode.Chase,
    );
    expect(chaseTarget(state, 'inky')).toEqual({ col: 4, row: 20 });
  });

  it('follows Blinky: moving him moves Inky’s target', () => {
    const base = board(PAC.col, PAC.row, Direction.Left);
    const near = chaseTarget(placeGhost(base, 'blinky', 12, 20, GhostMode.Chase), 'inky');
    const far = chaseTarget(placeGhost(base, 'blinky', 12, 10, GhostMode.Chase), 'inky');
    expect(near).not.toEqual(far);
  });

  it('inherits Pinky’s up bug through the pivot', () => {
    // Pivot with the bug is (8, 18); Blinky on Pac-Man doubles it about him.
    const state = placeGhost(
      board(PAC.col, PAC.row, Direction.Up),
      'blinky',
      PAC.col,
      PAC.row,
      GhostMode.Chase,
    );
    expect(chaseTarget(state, 'inky')).toEqual({ col: 6, row: 16 });
  });
});

describe('Clyde', () => {
  const corner = scatterTarget(playing(), 'clyde');

  it('hunts Pac-Man from further than eight tiles', () => {
    const state = placeGhost(
      board(PAC.col, PAC.row, Direction.Left),
      'clyde',
      PAC.col,
      PAC.row - (CLYDE_RADIUS + 1),
      GhostMode.Chase,
    );
    expect(chaseTarget(state, 'clyde')).toEqual(PAC);
  });

  it('breaks for his corner at exactly eight tiles — the rule is "more than"', () => {
    const state = placeGhost(
      board(PAC.col, PAC.row, Direction.Left),
      'clyde',
      PAC.col,
      PAC.row - CLYDE_RADIUS,
      GhostMode.Chase,
    );
    expect(chaseTarget(state, 'clyde')).toEqual(corner);
  });
});

describe('scatter corners', () => {
  it('sends each ghost to its own corner of the board', () => {
    const state = playing();
    expect(scatterTarget(state, 'blinky')).toEqual({ col: 25, row: -3 });
    expect(scatterTarget(state, 'pinky')).toEqual({ col: 2, row: -3 });
    expect(scatterTarget(state, 'inky')).toEqual({ col: 27, row: 32 });
    expect(scatterTarget(state, 'clyde')).toEqual({ col: 0, row: 32 });
  });

  it('places all four outside the walls, so none is ever reached', () => {
    const state = playing();
    for (const name of ['blinky', 'pinky', 'inky', 'clyde'] as const) {
      const { col, row } = scatterTarget(state, name);
      const outside = row < 0 || row >= MAZE_CLASSIC.rows || col < 0 || col >= MAZE_CLASSIC.cols;
      expect(outside, `${name}'s corner is on the board`).toBe(true);
    }
  });
});

describe('Cruise Elroy', () => {
  const tuning = tuningForLevel(1);

  function withRemaining(remaining: number): GameState {
    const state = playing();
    return { ...state, maze: { ...state.maze, remaining } };
  }

  it('escalates as the board empties', () => {
    const blinky = (state: GameState) => elroyStage(state, ghost(state, 'blinky'));
    expect(blinky(withRemaining(tuning.elroy1Dots + 1))).toBe(0);
    expect(blinky(withRemaining(tuning.elroy1Dots))).toBe(1);
    expect(blinky(withRemaining(tuning.elroy2Dots))).toBe(2);
  });

  it('is Blinky’s alone', () => {
    const state = withRemaining(tuning.elroy2Dots);
    for (const name of ['pinky', 'inky', 'clyde'] as const) {
      expect(elroyStage(state, ghost(state, name))).toBe(0);
    }
  });

  it('keeps Blinky chasing through a scatter', () => {
    const scattering = placePacman(withRemaining(tuning.elroy1Dots), PAC.col, PAC.row);
    const blinky = ghost(scattering, 'blinky');
    expect(blinky.mode).toBe(GhostMode.Scatter);
    expect(targetTile(scattering, blinky)).toEqual(PAC);
  });

  it('lets a scattering Blinky go home before the threshold', () => {
    const scattering = placePacman(withRemaining(tuning.elroy1Dots + 1), PAC.col, PAC.row);
    expect(targetTile(scattering, ghost(scattering, 'blinky'))).toEqual(
      scatterTarget(scattering, 'blinky'),
    );
  });
});

describe('eyes', () => {
  it('aim for the tile above the ghost-house door', () => {
    const state = placeGhost(playing(), 'blinky', 6, 8, GhostMode.Eaten);
    const door = MAZE_CLASSIC.house.door;
    expect(targetTile(state, ghost(state, 'blinky'))).toEqual({ col: door.x, row: door.y });
  });
});
