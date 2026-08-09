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
 *
 * A spec named `*.dom.test.ts` runs under jsdom wherever it lives. Some layers
 * — the input sources most of all — have a headless half and a DOM half that
 * belong in the same directory, and naming the environment beats scattering
 * them by runner or flipping it per file with a docblock the projects cannot
 * see.
 */
const DOM_SPECS = 'tests/**/*.dom.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/{sim,app,input,replays,boundary}/**/*.test.ts'],
          exclude: [DOM_SPECS],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.ts', DOM_SPECS],
        },
      },
    ],
    // `tests/e2e` is Playwright's. Node modules and build output never hold
    // specs.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
});
