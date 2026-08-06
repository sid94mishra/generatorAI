import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/**
 * Opt-in TLS for the dev server (`GENERATORAI_DEV_HTTPS=1`).
 *
 * Needed to pair a browser on a SECOND machine. Browsers only expose
 * `crypto.subtle` in a secure context, and `http://<lan-ip>` is not one — so
 * the device key that every paired device must generate cannot be created,
 * and pairing fails before it reaches the network. `localhost` is exempt from
 * that rule, which is why single-machine development works over plain HTTP
 * and this stays off by default.
 *
 * The certificate is self-signed, so the second machine sees a browser
 * warning once and has to accept it. After acceptance the origin is a proper
 * secure context and pairing behaves exactly as it does in production.
 */
const devHttps = process.env['GENERATORAI_DEV_HTTPS'] === '1';

// Read once at config time so the About panel can show the shipped version
// instead of a hardcoded literal that silently goes stale.
const { version: APP_VERSION } = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { version: string };

// WEB-03: rollup-plugin-visualizer emits `dist/stats.html` on every
// production build. CI reads the companion `dist/stats.json` to enforce
// the 800 KB gzipped total-bundle budget (see scripts/check-bundle-size.mjs).
// The visualizer is cheap (writes after bundle finalization) so it's
// always on rather than gated by an env flag.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(devHttps ? [basicSsl()] : []),
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
    // Listen on every interface so a phone or a second computer can open the
    // dev SPA without anyone editing a config file first. This is safe because
    // of `xfwd` below: the API still refuses unauthenticated access to anything
    // that arrives through this proxy from off-machine.
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        // NOT `changeOrigin: true`. DPoP proofs bind the request URI, and the
        // server reconstructs it from the Host header. Rewriting Host to the
        // proxy target makes every signed request fail HTU_MISMATCH, which
        // breaks pairing and token refresh through the dev server.
        changeOrigin: false,
        // Send X-Forwarded-For. Without it the proxied request reaches the
        // server as a plain loopback connection, and a server running in
        // development's unauthenticated-loopback mode would hand full
        // authority to anyone on the network who loaded this dev server.
        xfwd: true,
        // Forward WebSocket upgrade requests (used by
        // /api/workspaces/:id/browser/stream for high-fps live view).
        ws: true,
        // TLS stops at Vite, so the server sees a plain HTTP socket and would
        // rebuild the request URI as `http://…` while the browser signed its
        // DPoP proof over `https://…`. Setting the scheme explicitly keeps the
        // two in agreement; relying on the proxy's own TLS detection does not,
        // because it inspects socket internals that no longer exist on modern
        // Node.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('x-forwarded-proto', devHttps ? 'https' : 'http');
          });
        },
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
