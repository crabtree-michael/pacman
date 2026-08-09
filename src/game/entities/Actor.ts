import type { Maze } from '../maze/Maze';
import { DIRECTION_VECTORS, type Direction, type Vec2 } from '../types';

/** Float slop when testing whether we have landed on a tile centre, in tiles. */
const CENTRE_EPSILON = 1e-6;

/**
 * Shared movement substrate for Pac-Man and the ghosts.
 *
 * Position is in *tile units*, measured at the actor's centre — tile (3, 4)
 * has its centre at (3.5, 4.5). Actors travel down a lane and may only change
 * direction on a tile centre, which is what keeps everything on the grid.
 *
 * A single tick can cover more than the distance to the next centre, so
 * `update` walks the step in segments and re-evaluates turns at each centre it
 * passes through. Advancing by the whole step at once would let a fast actor
 * skip past a junction — or through a wall — between ticks.
 *
 * This is intentionally the minimum needed to move something around the board.
 * TODO(mechanics): cornering (pre-turning before the centre), per-level speed
 * tables, tunnel slow-down, and the ghosts' reverse-on-mode-change rule.
 */
export abstract class Actor {
  position: Vec2;
  direction: Direction;
  /** Requested direction, applied at the next tile centre where it is legal. */
  queuedDirection: Direction | null = null;

  protected constructor(
    protected readonly maze: Maze,
    spawnTile: Readonly<Vec2>,
    public speed: number,
    initialDirection: Direction = 'left',
  ) {
    this.position = { x: spawnTile.x + 0.5, y: spawnTile.y + 0.5 };
    this.direction = initialDirection;
  }

  /** The tile the actor currently occupies. */
  get tile(): Vec2 {
    return { x: Math.floor(this.position.x), y: Math.floor(this.position.y) };
  }

  reset(spawnTile: Readonly<Vec2>, initialDirection: Direction = 'left'): void {
    this.position = { x: spawnTile.x + 0.5, y: spawnTile.y + 0.5 };
    this.direction = initialDirection;
    this.queuedDirection = null;
  }

  update(dtSeconds: number): void {
    let remaining = this.speed * dtSeconds;

    while (remaining > CENTRE_EPSILON) {
      if (this.isOnTileCentre()) {
        this.snapToTileCentre();
        if (this.queuedDirection && this.canEnter(this.queuedDirection)) {
          this.direction = this.queuedDirection;
          this.queuedDirection = null;
        }
        if (!this.canEnter(this.direction)) {
          return; // Nose against a wall: hold here until a legal turn is queued.
        }
      }

      const step = Math.min(remaining, this.distanceToNextCentre());
      const vector = DIRECTION_VECTORS[this.direction];
      this.position.x += vector.x * step;
      this.position.y += vector.y * step;
      remaining -= step;
    }
  }

  /** True when the next tile in `direction` is enterable from here. */
  protected canEnter(direction: Direction): boolean {
    const vector = DIRECTION_VECTORS[direction];
    const { x: col, y: row } = this.tile;
    return !this.maze.isWall(col + vector.x, row + vector.y);
  }

  /** Distance along the current heading to the next tile centre ahead. */
  private distanceToNextCentre(): number {
    const vector = DIRECTION_VECTORS[this.direction];
    if (vector.x !== 0) {
      const next =
        vector.x > 0
          ? Math.floor(this.position.x + 0.5) + 0.5
          : Math.ceil(this.position.x - 0.5) - 0.5;
      return Math.abs(next - this.position.x);
    }
    const next =
      vector.y > 0
        ? Math.floor(this.position.y + 0.5) + 0.5
        : Math.ceil(this.position.y - 0.5) - 0.5;
    return Math.abs(next - this.position.y);
  }

  private isOnTileCentre(): boolean {
    const { x: col, y: row } = this.tile;
    return (
      Math.abs(this.position.x - (col + 0.5)) < CENTRE_EPSILON &&
      Math.abs(this.position.y - (row + 0.5)) < CENTRE_EPSILON
    );
  }

  private snapToTileCentre(): void {
    const { x: col, y: row } = this.tile;
    this.position.x = col + 0.5;
    this.position.y = row + 0.5;
  }
}
