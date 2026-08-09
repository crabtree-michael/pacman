import { GHOST_SPEED } from '../constants';
import type { Maze } from '../maze/Maze';
import type { Vec2 } from '../types';
import { Actor } from './Actor';

export type GhostName = 'blinky' | 'pinky' | 'inky' | 'clyde';

/**
 * A ghost. Rendered and positioned, but not yet driven.
 *
 * TODO(ghosts): scatter/chase/frightened modes, the per-ghost target-tile
 * rules, the house release timers, and eaten-eyes routing home. Until then
 * ghosts hold their spawn tile so the renderer and the collision work have
 * something real to sit against.
 */
export class Ghost extends Actor {
  constructor(
    maze: Maze,
    readonly name: GhostName,
    readonly color: string,
    private readonly spawnTile: Readonly<Vec2>,
  ) {
    super(maze, spawnTile, GHOST_SPEED, 'up');
  }

  override update(_dtSeconds: number): void {
    // Deliberately inert — see the class TODO.
  }

  respawn(): void {
    this.reset(this.spawnTile, 'up');
  }
}
