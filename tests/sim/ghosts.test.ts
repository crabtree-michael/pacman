import { describe, expect, it } from 'vitest';
import { STEP_MS } from '../../src/app/loop';
import { MAZE_CLASSIC, type MazeData } from '../../src/data/maze-classic';
import { EYES_SPEED_PCT } from '../../src/sim/ghosts/ghost';
import { speedFromPct, tuningForLevel } from '../../src/sim/levels';
import { isInsideHouse, isWall } from '../../src/sim/maze';
import { actorTile } from '../../src/sim/movement';
import { step } from '../../src/sim/step';
import {
  Direction,
  GhostMode,
  Phase,
  opposite,
  type GameState,
  type GhostMode as Mode,
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
 * The shared ghost movement engine (architecture §3.5 and §9 "Movement").
 *
 * Where a ghost aims is `targeting.test.ts`. This is about how it gets there:
 * the rules that hold for every ghost in every mode, and the two places the
 * board bends them — the four no-up tiles and the tunnel.
 */

const TUNING = tuningForLevel(1);

/** Modes in which a ghost is out on the board under its own steam. */
function isLoose(mode: Mode): boolean {
  return (
    mode === GhostMode.Scatter || mode === GhostMode.Chase || mode === GhostMode.Frightened
  );
}

describe('the rules every ghost keeps', () => {
  it('never clips a wall and never turns back unbidden', () => {
    // A whole life of a real game, ghosts released on their own schedule and
    // Pac-Man walking into the bottom-left power pellet on the way. Both rules
    // are invariants, so the useful test is the long one.
    let state = playing();

    for (let tick = 0; tick < 900 && state.phase === Phase.Playing; tick++) {
      const previous = state;
      state = step(state, IDLE, STEP_MS);

      // The two events that hand down a reversal: a scatter↔chase transition
      // and a power pellet (product spec §4.3).
      const forced =
        state.modeTimer.index !== previous.modeTimer.index ||
        state.fright.msRemaining > previous.fright.msRemaining;

      for (const [index, current] of state.ghosts.entries()) {
        const before = previous.ghosts[index];
        if (!before || !isLoose(current.mode) || before.mode !== current.mode) continue;

        const tile = actorTile(MAZE_CLASSIC, current);
        expect(
          isWall(MAZE_CLASSIC, tile.col, tile.row),
          `${current.name} stood in a wall at ${tile.col},${tile.row} on tick ${tick}`,
        ).toBe(false);

        if (forced) continue;
        expect(
          current.dir,
          `${current.name} turned round unbidden on tick ${tick}`,
        ).not.toBe(opposite(before.dir));
      }
    }
  });

  it('runs the same route twice from the same state', () => {
    // Frightened ghosts are the only ones that consult the PRNG, so this is
    // where determinism is worth re-proving (architecture §1).
    const state = frightenedBoard();
    expect(positions(advance(state, 240))).toEqual(positions(advance(state, 240)));
  });

  it('takes a different route on a different seed', () => {
    const state = frightenedBoard();
    expect(positions(advance(state, 240))).not.toEqual(
      positions(advance({ ...state, rng: 0x1234567 }, 240)),
    );
  });
});

describe('the no-up tiles', () => {
  /**
   * Blinky walking west along the corridor over the ghost house, with Pac-Man
   * parked directly above the junction at column 12. Up is both legal and much
   * closer to the target, so the only thing that can keep him going straight is
   * the rule (product spec §4.1).
   */
  function approachTheJunction(maze: MazeData): GameState {
    const start = placeGhost(
      freezePacman(placePacman(playing(), 12, 8)),
      'blinky',
      15,
      11,
      GhostMode.Chase,
      Direction.Left,
    );
    return advance({ ...start, maze: { ...start.maze, data: maze } }, 40);
  }

  it('refuses the turn even when the target is straight up it', () => {
    const blinky = ghost(approachTheJunction(MAZE_CLASSIC), 'blinky');
    expect(actorTile(MAZE_CLASSIC, blinky).row).toBe(11);
  });

  it('is the tile list doing it, not the geometry', () => {
    // The same run on a board with the list emptied: now he turns up, which is
    // what proves the first case is the rule rather than a wall.
    const open: MazeData = { ...MAZE_CLASSIC, noUpTiles: [] };
    const blinky = ghost(approachTheJunction(open), 'blinky');
    expect(actorTile(open, blinky).row).toBeLessThan(11);
  });
});

describe('ghost speed', () => {
  function speedAt(col: number, row: number, mode: Mode, state = playing()): number {
    const placed = placeGhost(freezePacman(state), 'blinky', col, row, mode);
    return ghost(advance(placed, 1), 'blinky').speed;
  }

  it('crawls in the side tunnel', () => {
    expect(speedAt(1, MAZE_CLASSIC.tunnelRow, GhostMode.Chase)).toBe(
      speedFromPct(TUNING.ghostTunnelSpeedPct),
    );
    expect(speedAt(6, 11, GhostMode.Chase)).toBe(speedFromPct(TUNING.ghostSpeedPct));
  });

  it('drops while frightened and flies while eaten', () => {
    expect(speedAt(6, 11, GhostMode.Frightened)).toBe(
      speedFromPct(TUNING.ghostFrightSpeedPct),
    );
    expect(speedAt(6, 11, GhostMode.Eaten)).toBe(speedFromPct(EYES_SPEED_PCT));
  });

  it('rises with Blinky’s Elroy stages as the board empties', () => {
    const emptying = (remaining: number): GameState => {
      const state = playing();
      return { ...state, maze: { ...state.maze, remaining } };
    };

    expect(speedAt(6, 11, GhostMode.Chase, emptying(TUNING.elroy1Dots + 1))).toBe(
      speedFromPct(TUNING.ghostSpeedPct),
    );
    expect(speedAt(6, 11, GhostMode.Chase, emptying(TUNING.elroy1Dots))).toBe(
      speedFromPct(TUNING.elroy1SpeedPct),
    );
    expect(speedAt(6, 11, GhostMode.Chase, emptying(TUNING.elroy2Dots))).toBe(
      speedFromPct(TUNING.elroy2SpeedPct),
    );
  });

  it('leaves a frightened Elroy as slow as any other frightened ghost', () => {
    const state = playing();
    const nearlyClear = { ...state, maze: { ...state.maze, remaining: TUNING.elroy2Dots } };
    expect(speedAt(6, 11, GhostMode.Frightened, nearlyClear)).toBe(
      speedFromPct(TUNING.ghostFrightSpeedPct),
    );
  });
});

describe('eyes', () => {
  it('travel home, drop into the house and come back out in play', () => {
    const eaten = advance(eatBlinky(), 1);
    expect(ghost(eaten, 'blinky').mode).toBe(GhostMode.Eaten);

    let sawTheHouse = false;
    const home = advanceUntil(
      eaten,
      (state) => {
        const tile = actorTile(MAZE_CLASSIC, ghost(state, 'blinky'));
        if (isInsideHouse(MAZE_CLASSIC, tile.col, tile.row)) sawTheHouse = true;
        return ghost(state, 'blinky').mode !== GhostMode.Eaten;
      },
      'the eyes to get home',
      900,
    );

    expect(sawTheHouse).toBe(true);
    expect(ghost(home, 'blinky').mode).toBe(GhostMode.Leaving);

    const back = advanceUntil(
      home,
      (state) => isLoose(ghost(state, 'blinky').mode),
      'Blinky back in play',
      900,
    );
    // Back on the board in the mode the global cursor is in — not frightened,
    // however much of the power pellet is left (product spec §4.3).
    expect(ghost(back, 'blinky').mode).toBe(GhostMode.Scatter);
    expect(actorTile(MAZE_CLASSIC, ghost(back, 'blinky'))).toEqual({
      col: MAZE_CLASSIC.house.door.x,
      row: MAZE_CLASSIC.house.door.y,
    });
  });

  it('are not slowed by the tunnel they cross on the way', () => {
    const inTunnel = placeGhost(
      freezePacman(playing()),
      'blinky',
      1,
      MAZE_CLASSIC.tunnelRow,
      GhostMode.Eaten,
    );
    expect(ghost(advance(inTunnel, 1), 'blinky').speed).toBe(speedFromPct(EYES_SPEED_PCT));
  });
});

/** A board where Blinky is blue and everyone can be counted on to stay put. */
function frightenedBoard(): GameState {
  const state = freezePacman(placePacman(playing(), 13, 23));
  return {
    ...placeGhost(state, 'blinky', 13, 20, GhostMode.Frightened),
    fright: { active: true, msRemaining: 60_000, ghostsEaten: 0 },
  };
}

/** The tick before Pac-Man swallows a frightened Blinky standing on him. */
function eatBlinky(): GameState {
  const state = freezePacman(playing());
  const pacman = actorTile(MAZE_CLASSIC, state.pacman);
  return {
    ...placeGhost(state, 'blinky', pacman.col, pacman.row, GhostMode.Frightened),
    fright: { active: true, msRemaining: 60_000, ghostsEaten: 0 },
  };
}

/** Every ghost's position, as the comparable value a route test needs. */
function positions(state: GameState): string {
  return state.ghosts.map((g) => `${g.name}:${g.x},${g.y},${g.dir}`).join(' ');
}
