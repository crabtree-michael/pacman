import { InputManager } from '../input/InputManager';
import { Joystick } from '../input/Joystick';
import { KeyboardInput } from '../input/KeyboardInput';
import { CanvasRenderer } from '../render/CanvasRenderer';
import { Hud } from '../ui/Hud';
import { COLORS, STARTING_LIVES } from './constants';
import { Ghost, type GhostName } from './entities/Ghost';
import { Pacman } from './entities/Pacman';
import { GameLoop } from './GameLoop';
import { Maze } from './maze/Maze';
import { GHOST_SPAWN_TILES } from './maze/layout';

export interface GameElements {
  canvas: HTMLCanvasElement;
  /** Box the canvas is fitted into. */
  stage: HTMLElement;
  joystick: HTMLElement;
  hud: HTMLElement;
}

const GHOST_NAMES: readonly GhostName[] = ['blinky', 'pinky', 'inky', 'clyde'];

/**
 * Wires the pieces together and owns the game's state.
 *
 * The seams are deliberate: the loop knows nothing about the game, the
 * renderer only reads the scene, and input arrives as "a direction the player
 * wants" rather than as events. Mechanics land inside `update` without any of
 * those pieces having to change.
 */
export class Game {
  private readonly maze: Maze;
  private readonly pacman: Pacman;
  private readonly ghosts: readonly Ghost[];
  private readonly renderer: CanvasRenderer;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly loop: GameLoop;

  private score = 0;
  private lives = STARTING_LIVES;

  constructor(elements: GameElements) {
    this.maze = new Maze();
    this.pacman = new Pacman(this.maze);
    this.ghosts = GHOST_NAMES.map(
      (name, index) =>
        new Ghost(
          this.maze,
          name,
          COLORS.ghosts[index] ?? COLORS.ghosts[0],
          GHOST_SPAWN_TILES[index] ?? GHOST_SPAWN_TILES[0],
        ),
    );

    this.renderer = new CanvasRenderer(elements.canvas, elements.stage, {
      cols: this.maze.cols,
      rows: this.maze.rows,
    });

    this.input = new InputManager()
      .use(new Joystick(elements.joystick))
      .use(new KeyboardInput());

    this.hud = new Hud(elements.hud);
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);

    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: (alpha) => this.render(alpha),
    });

    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.loop.stop();
    this.input.destroy();
    this.renderer.destroy();
  }

  private update(dtSeconds: number): void {
    const steer = this.input.direction;
    if (steer) {
      this.pacman.steer(steer);
    }

    this.pacman.update(dtSeconds);
    for (const ghost of this.ghosts) {
      ghost.update(dtSeconds);
    }

    // TODO(mechanics): pellet collection and scoring, power-pellet mode,
    // Pac-Man/ghost collisions, life loss and respawn, level completion.
  }

  private render(_alpha: number): void {
    // TODO(render): use `_alpha` to interpolate actor positions between the
    // two most recent simulation steps once movement is final.
    this.renderer.render({
      maze: this.maze,
      pacman: this.pacman,
      ghosts: this.ghosts,
    });
  }

  /** Don't simulate while backgrounded — it drains battery and desyncs input. */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.loop.stop();
      this.input.clearDirection();
    } else {
      this.loop.start();
    }
  };
}
