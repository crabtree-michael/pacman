/**
 * Local persistence. High score and settings are the only state that outlives
 * a session, and there is no backend for v1 (architecture §8.3).
 */

const HIGH_SCORE_KEY = 'pacman.highScore';
const SETTINGS_KEY = 'pacman.settings';

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

/** Which side of the screen the joystick lives on (product spec §3.4). */
export type Handedness = 'left' | 'right';

/**
 * Player-controlled input options.
 *
 * These are the settings the *input* layer reads. The screen that toggles them
 * is `TODO(ui)` along with the rest of the menus; until it exists the defaults
 * ship and the stored values are honoured, so the settings screen only has to
 * call `saveSettings` when it lands.
 */
export interface Settings {
  /** Mirrors joystick placement in landscape and on tablets. */
  handedness: Handedness;
  /** Accessibility: a 1.5x stick with a proportionally wider dead zone. */
  largeJoystick: boolean;
  /** A 10 ms pulse on each direction change, where the device supports it. */
  haptics: boolean;
  /** Swipe-to-steer on the maze (product spec §3.3). */
  swipe: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  handedness: 'left',
  largeJoystick: false,
  haptics: true,
  swipe: true,
};

function readBoolean(
  source: Record<string, unknown>,
  key: keyof Settings,
  fallback: boolean,
): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Read the stored settings, falling back per-field.
 *
 * Every field is validated individually rather than trusting the parsed blob:
 * this is data the player's own browser can hand back in any shape, and a
 * half-corrupt record should cost one setting, not the whole game.
 */
export function loadSettings(): Settings {
  const raw = safeRead(SETTINGS_KEY);
  if (raw === null) return { ...DEFAULT_SETTINGS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };

  const source = parsed as Record<string, unknown>;
  return {
    handedness: source['handedness'] === 'right' ? 'right' : DEFAULT_SETTINGS.handedness,
    largeJoystick: readBoolean(source, 'largeJoystick', DEFAULT_SETTINGS.largeJoystick),
    haptics: readBoolean(source, 'haptics', DEFAULT_SETTINGS.haptics),
    swipe: readBoolean(source, 'swipe', DEFAULT_SETTINGS.swipe),
  };
}

export function saveSettings(settings: Settings): void {
  safeWrite(SETTINGS_KEY, JSON.stringify(settings));
}
