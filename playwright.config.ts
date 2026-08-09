import { defineConfig, devices } from '@playwright/test';

/**
 * Integration smoke tests on mobile emulation profiles (architecture §7, §9).
 *
 * Two engines, not one. Chromium stands in for Android; WebKit is the one that
 * matters, because every platform risk in architecture §10 — swallowed touch
 * events near screen edges, address-bar collapse mid-game, audio staying
 * suspended — is an iOS Safari problem. Emulation is not a substitute for a
 * real handset, but it catches the breakages that are not device-specific.
 *
 * Set `E2E_TARGET=preview` to run against the production build instead of the
 * dev server — worth doing before a release, since minification and the
 * absence of HMR are exactly what the dev server hides.
 */
const usePreview = process.env['E2E_TARGET'] === 'preview';
const port = usePreview ? 4173 : 5173;

export default defineConfig({
  testDir: 'tests/e2e',
  // The suite is a handful of specs; a full run should stay well under a minute.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    video: 'off',
  },

  projects: [
    { name: 'android', use: { ...devices['Pixel 5'] } },
    { name: 'ios', use: { ...devices['iPhone 13'] } },
  ],

  webServer: {
    command: usePreview ? 'npm run build && npm run preview' : 'npm run dev',
    url: `http://localhost:${port}`,
    // Locally, reuse a dev server you already have open; in CI always start a
    // clean one.
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
