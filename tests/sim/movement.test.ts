import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { PENDING_TTL_MS, isTurnLegal, movePacman } from '../../src/sim/movement';
import { createInitialState } from '../../src/sim/state';
import { Direction, SUBTILE, tileCentre, tileOf, type PacmanState } from '../../src/sim/types';

/**
 * Table-driven movement checks (architecture §9, "Movement").
 *
 * Deliberately thin: this ticket sets up the harness, and the full cornering /
 * no-up-tile tables land with the movement and ghost tickets. What is here
 * proves the runner reaches `sim/` under plain Node and that the existing
 * grid-lock behaviour is pinned.
 */

function pacmanAt(col: number, row: number, dir: Direction, speed = 32): PacmanState {
  return {
    x: tileCentre(col),
    y: tileCentre(row),
    dir,
    speed,
    animTicks: 0,
    pendingDir: Direction.None,
    pendingAge: 0,
  };
}

describe('turn legality', () => {
  // Pac-Man's spawn sits in a horizontal corridor: walls above and below.
  const spawn = MAZE_CLASSIC.spawns.pacman;
  const cases: ReadonlyArray<[string, Direction, boolean]> = [
    ['up into the wall above the spawn', Direction.Up, false],
    ['down into the wall below the spawn', Direction.Down, false],
    ['left along the corridor', Direction.Left, true],
    ['right along the corridor', Direction.Right, true],
  ];

  for (const [name, dir, expected] of cases) {
    it(`${expected ? 'allows' : 'refuses'} a turn ${name}`, () => {
      const actor = pacmanAt(spawn.x, spawn.y, Direction.Left);
      expect(isTurnLegal(MAZE_CLASSIC, actor, dir)).toBe(expected);
    });
  }
});

describe('grid-locked motion', () => {
  it('stops against a wall instead of clipping through it', () => {
    const actor = pacmanAt(MAZE_CLASSIC.spawns.pacman.x, MAZE_CLASSIC.spawns.pacman.y, Direction.Up);
    for (let tick = 0; tick < 120; tick++) {
      movePacman(MAZE_CLASSIC, actor, STEP_MS);
    }
    expect(actor.y).toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.y));
  });

  it('applies a reversal immediately, mid-corridor', () => {
    const actor = pacmanAt(MAZE_CLASSIC.spawns.pacman.x, MAZE_CLASSIC.spawns.pacman.y, Direction.Left);
    movePacman(MAZE_CLASSIC, actor, STEP_MS); // Step off the tile centre first.
    expect(actor.x).not.toBe(tileCentre(MAZE_CLASSIC.spawns.pacman.x));

    actor.pendingDir = Direction.Right;
    movePacman(MAZE_CLASSIC, actor, STEP_MS);
    expect(actor.dir).toBe(Direction.Right);
    expect(actor.pendingDir).toBe(Direction.None);
  });

  it('discards a buffered turn that never becomes legal', () => {
    const actor = pacmanAt(MAZE_CLASSIC.spawns.pacman.x, MAZE_CLASSIC.spawns.pacman.y, Direction.Left);
    actor.pendingDir = Direction.Up; // Wall above: this can never be taken here.

    const ticks = Math.ceil(PENDING_TTL_MS / STEP_MS);
    for (let tick = 0; tick < ticks; tick++) {
      movePacman(MAZE_CLASSIC, actor, STEP_MS);
    }
    expect(actor.pendingDir).toBe(Direction.None);
  });

  it('wraps through the side tunnel without leaving the board', () => {
    const span = MAZE_CLASSIC.cols * SUBTILE;
    const actor = pacmanAt(0, MAZE_CLASSIC.tunnelRow, Direction.Left);

    let wrapped = false;
    for (let tick = 0; tick < 60; tick++) {
      movePacman(MAZE_CLASSIC, actor, STEP_MS);
      expect(actor.x).toBeGreaterThanOrEqual(0);
      expect(actor.x).toBeLessThan(span);
      if (tileOf(actor.x) > MAZE_CLASSIC.cols / 2) wrapped = true;
    }
    expect(wrapped).toBe(true);
  });
});

describe('initial state', () => {
  it('places every actor on an exact tile centre', () => {
    const state = createInitialState(MAZE_CLASSIC);
    const actors = [state.pacman, ...state.ghosts];
    for (const actor of actors) {
      expect((actor.x - SUBTILE / 2) % SUBTILE).toBe(0);
      expect((actor.y - SUBTILE / 2) % SUBTILE).toBe(0);
    }
  });

  it('lays out the 244 collectibles the product spec calls for', () => {
    expect(createInitialState(MAZE_CLASSIC).maze.remaining).toBe(244);
  });
});
