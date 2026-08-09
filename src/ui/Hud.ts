/**
 * Score and lives readout.
 *
 * Deliberately DOM rather than canvas: text laid out by the browser stays
 * crisp at any density, respects the user's font settings, and is readable by
 * assistive tech for free.
 */
export class Hud {
  private readonly scoreEl: HTMLElement;
  private readonly livesEl: HTMLElement;

  constructor(root: HTMLElement) {
    const scoreEl = root.querySelector<HTMLElement>('[data-hud="score"]');
    const livesEl = root.querySelector<HTMLElement>('[data-hud="lives"]');
    if (!scoreEl || !livesEl) {
      throw new Error('HUD is missing its [data-hud="score"] / [data-hud="lives"] elements');
    }
    this.scoreEl = scoreEl;
    this.livesEl = livesEl;
  }

  setScore(score: number): void {
    this.scoreEl.textContent = String(score);
  }

  setLives(lives: number): void {
    this.livesEl.textContent = String(lives);
  }
}
