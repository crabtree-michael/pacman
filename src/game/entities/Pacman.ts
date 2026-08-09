import { PACMAN_SPEED } from '../constants';
import type { Maze } from '../maze/Maze';
import { PACMAN_SPAWN_TILE } from '../maze/layout';
import type { Direction } from '../types';
import { Actor } from './Actor';

/** How many mouth open/close cycles per second. */
const MOUTH_CYCLES_PER_SECOND = 4;

export class Pacman extends Actor {
  /** 0 = fully open, 1 = fully closed. Drives the renderer's mouth wedge. */
  mouthPhase = 0;

  constructor(maze: Maze) {
    super(maze, PACMAN_SPAWN_TILE, PACMAN_SPEED, 'left');
  }

  /**
   * Steering from the player. The turn is only *queued* — `Actor.update`
   * applies it at the next tile centre where it is legal, which is what makes
   * an early swipe feel responsive instead of getting dropped.
   */
  steer(direction: Direction): void {
    this.queuedDirection = direction;
  }

  override update(dtSeconds: number): void {
    super.update(dtSeconds);
    this.mouthPhase = (this.mouthPhase + dtSeconds * MOUTH_CYCLES_PER_SECOND) % 1;
  }

  respawn(): void {
    this.reset(PACMAN_SPAWN_TILE, 'left');
    this.mouthPhase = 0;
  }
}
