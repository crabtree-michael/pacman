import { defineConfig } from 'vitest/config';

/**
 * Test harness for the headless layers (architecture §7, §9).
 *
 * Two projects rather than one, because the split mirrors the architecture's
 * central invariant: `sim/` is pure and must keep running under plain Node with
 * no DOM in scope at all. A single jsdom-everywhere config would happily let a
 * `document` reference sneak into the simulation and never fail — which is
 * exactly the regression `tests/boundary` exists to catch.
 *
 * Playwright owns `tests/e2e`; it is excluded here so the two runners never
 * pick up each other's specs.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/{sim,app,input,replays,boundary}/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.ts'],
        },
      },
    ],
    // `tests/e2e` is Playwright's. Node modules and build output never hold
    // specs.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
