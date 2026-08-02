import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

// WEB-03: rollup-plugin-visualizer emits `dist/stats.html` on every
// production build. CI reads the companion `dist/stats.json` to enforce
// the 800 KB gzipped total-bundle budget (see scripts/check-bundle-size.mjs).
// The visualizer is cheap (writes after bundle finalization) so it's
// always on rather than gated by an env flag.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: false,
      // `emitFile: false` keeps stats.html out of the bundle graph.
      emitFile: false,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Resolved to source so the auth runtime hot-reloads with the SPA and
      // does not need a separate build step during development.
      '@generatorai/client-runtime': resolve(
        __dirname,
        '../../packages/client-runtime/src/index.ts',
      ),
    },
  },
  // @pierre/diffs runs Shiki syntax highlighting in a Web Worker pool so
  // large diffs never block the main thread. Its worker is an ES module, so
  // Vite must emit workers in that format.
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        // Forward WebSocket upgrade requests (used by
        // /api/workspaces/:id/browser/stream for high-fps live view).
        ws: true,
      },
    },
  },
  // `vite preview` serves the real production bundle. Without the same proxy
  // every /api call 404s, so the only locally reachable build is the dev one —
  // which is precisely the build whose timings do NOT represent users, because
  // dev mode ships hundreds of unbundled ES modules.
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
