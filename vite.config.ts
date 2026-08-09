import { defineConfig } from 'vite';

export default defineConfig({
  // Static build — no server-side component. See README "Deployment".
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    // Bind on all interfaces so the dev server is reachable from a phone on
    // the same network — the primary way we test this game.
    host: true,
    port: 5173,
    // A silent slide to :5174 would leave the URL bookmarked on your phone
    // pointing at nothing. Better to fail and say the port is busy.
    strictPort: true,
  },
  preview: {
    // Same reasoning as `server`, and it matters more here: the production
    // build is the thing that ships, and the touch feel of a minified bundle
    // on a real handset is not something the dev server can stand in for.
    host: true,
    port: 4173,
    // Fail loudly rather than sliding to another port — the Playwright config
    // and the URL you typed into your phone both assume this one.
    strictPort: true,
  },
});
