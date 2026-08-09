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
  },
});
