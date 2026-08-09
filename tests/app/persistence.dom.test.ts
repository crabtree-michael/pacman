import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/app/persistence';

/**
 * Settings are the only persisted state besides the high score (product spec
 * §4.4), and they come back from a store the player's own browser owns. The
 * cases that matter are therefore the hostile ones.
 */

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('settings persistence', () => {
  it('hands back the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a full record', () => {
    const settings = {
      handedness: 'right',
      largeJoystick: true,
      haptics: false,
      swipe: false,
      sound: false,
    } as const;

    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it('returns a fresh object, so a caller cannot mutate the defaults', () => {
    const first = loadSettings();
    first.largeJoystick = true;
    expect(loadSettings().largeJoystick).toBe(DEFAULT_SETTINGS.largeJoystick);
  });

  it('falls back per field rather than dropping the whole record', () => {
    localStorage.setItem(
      'pacman.settings',
      JSON.stringify({ handedness: 'right', largeJoystick: 'yes please' }),
    );

    const settings = loadSettings();
    // The one good field survives; the corrupt one costs only itself.
    expect(settings.handedness).toBe('right');
    expect(settings.largeJoystick).toBe(DEFAULT_SETTINGS.largeJoystick);
    expect(settings.haptics).toBe(DEFAULT_SETTINGS.haptics);
  });

  it('survives unparseable JSON', () => {
    localStorage.setItem('pacman.settings', '{not json at all');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives a stored value that is not a settings object', () => {
    for (const stored of ['null', '42', '"left"', '[]']) {
      localStorage.setItem('pacman.settings', stored);
      expect(loadSettings(), `stored ${stored}`).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('rejects a handedness value that is not one of the two', () => {
    localStorage.setItem('pacman.settings', JSON.stringify({ handedness: 'sideways' }));
    expect(loadSettings().handedness).toBe(DEFAULT_SETTINGS.handedness);
  });

  it('does not break the game when storage throws', () => {
    // Private-mode Safari throws on write, and can throw on read too.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});
