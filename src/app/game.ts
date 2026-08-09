import type { MazeData } from '../data/maze-classic';
import { PhaseEvent, applyPhaseEvent } from '../sim/phases';
import { createInitialState } from '../sim/state';
import { step } from '../sim/step';
import { Phase, type GameEvent, type GameState, type InputSnapshot } from '../sim/types';
import { GameLoop } from './loop';

/**
 * The seam between the pure simulation and everything that touches the device.
 *
 * It owns the two states the renderer interpolates between, drives them from
 * the fixed-timestep loop, and turns app-level intentions — the pause button, a
 * backgrounded tab, assets finishing — into phase events. Nothing here decides
 * game flow; that is `sim/phases.ts`. This module only decides *when to ask*.
 *
 * Collaborators arrive as structural interfaces so the wiring can be tested
 * without a canvas: `Renderer`, `Hud` and `InputController` satisfy them as
 * they are.
 */

export interface GameView {
  render(previous: GameState, current: GameState, alpha: number): void;
}

export interface GameChrome {
  update(state: GameState, highScore: number): void;
}

export interface GameInput {
  sample(nowMs: number): void;
  snapshot(): InputSnapshot;
  reset(): void;
}

export interface HighScoreStore {
  load(): number;
  save(score: number): void;
}

export interface GameOptions {
  maze: MazeData;
  view: GameView;
  chrome: GameChrome;
  input: GameInput;
  highScore: HighScoreStore;
  /** Clock for input timestamps. Injectable so tests need no real `performance`. */
  now?(): number;
}

export class Game {
  readonly loop: GameLoop;

  private previous: GameState;
  private current: GameState;
  private highScore: number;

  constructor(private readonly options: GameOptions) {
    this.current = createInitialState(options.maze);
    this.previous = this.current;
    this.highScore = options.highScore.load();

    this.loop = new GameLoop({
      step: (stepMs) => this.advance(stepMs),
      render: (alpha) => this.draw(alpha),
      // Backgrounding pauses; returning shows the pause overlay rather than
      // resuming into a moving Pac-Man (product spec §4.6).
      onSuspend: () => this.pause(),
    });
  }

  get state(): GameState {
    return this.current;
  }

  get phase(): Phase {
    return this.current.phase;
  }

  get isPaused(): boolean {
    return this.current.phase === Phase.Paused;
  }

  get bestScore(): number {
    return this.highScore;
  }

  /** Begin driving frames. The game itself stays at the boot gate until told. */
  start(): void {
    this.loop.start();
  }

  /** Open the boot gate: assets have decoded (architecture §5.3). */
  assetsLoaded(): boolean {
    return this.send(PhaseEvent.AssetsReady);
  }

  /** The attract screen's TAP TO PLAY. */
  startGame(): boolean {
    return this.send(PhaseEvent.StartRequested);
  }

  pause(): boolean {
    if (!this.send(PhaseEvent.PauseRequested)) return false;
    // Drop the latch: a direction still held when the player paused must not
    // walk Pac-Man into a ghost the instant they come back.
    this.options.input.reset();
    return true;
  }

  resume(): boolean {
    return this.send(PhaseEvent.ResumeRequested);
  }

  restart(): boolean {
    return this.send(PhaseEvent.RestartRequested);
  }

  /** One simulation tick. Wired to the loop; called directly by tests. */
  advance(stepMs: number): void {
    this.options.input.sample(this.now());
    this.previous = this.current;
    this.current = step(this.current, this.options.input.snapshot(), stepMs);
    this.settle();
  }

  /** One frame. `alpha` is the loop's leftover accumulator fraction. */
  draw(alpha: number): void {
    this.options.view.render(this.previous, this.current, alpha);
    this.options.chrome.update(this.current, this.highScore);
  }

  destroy(): void {
    this.loop.destroy();
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }

  /**
   * Apply a phase event outside the tick loop.
   *
   * The interpolation pair collapses, because a transition moves no sprites:
   * interpolating a `previous` from before it would smear one frame of the
   * card that just appeared.
   */
  private send(event: PhaseEvent): boolean {
    const next = applyPhaseEvent(this.current, event);
    if (next === this.current) return false;
    this.current = next;
    this.previous = next;
    this.settle();
    return true;
  }

  private settle(): void {
    if (this.current.score > this.highScore) {
      this.highScore = this.current.score;
      this.options.highScore.save(this.highScore);
    }
    this.drain(this.current.events);
  }

  /**
   * Consume the simulation's event queue (architecture §3.2).
   *
   * The queue is the only way out of the simulation, so anything that reacts to
   * gameplay reads it here and cannot reach back in.
   */
  private drain(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'PhaseChanged' && event.to === Phase.Ready) {
        // Level start and respawn both land in Ready. Clearing the latch there
        // is the app-side half of `resetActors` (product spec, open question 1).
        this.options.input.reset();
      }
    }
    // TODO(audio): hand the same queue to the audio director — chomp, death,
    // and the Ready jingle are all in here already (product spec §4.7).
  }
}
