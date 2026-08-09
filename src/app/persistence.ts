/**
 * Local persistence. High score and settings are the only state that outlives
 * a session, and there is no backend for v1 (architecture §8.3).
 */

const HIGH_SCORE_KEY = 'pacman.highScore';

/** Private-mode Safari throws on `localStorage` writes, so every access is guarded. */
function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A lost high score is not worth breaking the game over.
  }
}

export function loadHighScore(): number {
  const raw = safeRead(HIGH_SCORE_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function saveHighScore(score: number): void {
  safeWrite(HIGH_SCORE_KEY, String(Math.max(0, Math.floor(score))));
}
