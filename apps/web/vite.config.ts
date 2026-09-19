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

/**
 * Where `/api` is proxied in dev. Hardcoding 3100 meant a second server — a
 * different harness, a scratch database, a perf run — could not be reached
 * from the dev SPA at all without editing this file.
 */
const apiTarget = process.env['GENERATORAI_DEV_API_TARGET'] ?? 'http://localhost:3100';

// Read once at config time so the About panel can show the shipped version
// instead of a hardcoded literal that silently goes stale.
const { version: APP_VERSION } = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { version: string };

// WEB-03: rollup-plugin-visualizer emits `dist/stats.html` on every
// production build, for humans investigating a size regression. The
// 800 KB gzipped budget itself is enforced by scripts/check-bundle-size.mjs,
// which reads `dist/index.html`'s own entry script + modulepreload list
// directly rather than this file — that list IS the initial-load payload,
// so it doesn't need a separate stats artifact. The visualizer is cheap
// (writes after bundle finalization) so it's always on rather than gated
// by an env flag.
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
        target: apiTarget,
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
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // The AudioWorklet module must stay a real FILE. Vite inlines any `?url`
    // asset under 4KB as a `data:` URI, and the app's own CSP is
    // `script-src 'self'` — so an inlined worklet is refused by the browser
    // exactly like the `blob:` URL it replaced, and dictation fails with
    // "Unable to load a worklet's module". Everything else keeps the default
    // inlining, which is a genuine win for small icons.
    assetsInlineLimit: (filePath: string) =>
      filePath.endsWith('pcm-worklet.js') ? false : undefined,
    // W28: Hidden source maps — generated but NOT shipped to browsers.
    // Source maps are emitted as separate `.js.map` files, meaning a user's
    // browser never downloads them (the DevTools sourceMappingURL comment that
    // would trigger the download is absent). CI/Sentry can still upload the
    // map files from `dist/` for stack-trace de-minification. Previously
    // `sourcemap: true` shipped the maps inline, bloating gzipped bundles by
    // ~3× and making the "4× over budget" figure worse than the actual code.
    sourcemap: 'hidden',
    // W28: Raise the warning threshold so the CI budget check (800 KB gzipped)
    // drives enforcement instead of build warnings. The warning fires per chunk
    // so with 389 chunks it was a wall of noise that masked real regressions.
    // Our `check-bundle-size.mjs` reads `dist/stats.json` for the definitive
    // per-file and total-gzip figures.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // W28: Manual vendor split — moves the heaviest stable dependencies into
        // their own chunks so they are long-lived by the CDN/service-worker cache
        // even when application code changes. Grouped by change frequency so
        // a patch to react-query doesn't evict the React runtime.
        manualChunks(id: string) {
          // ── React runtime (changes only on React upgrades) ───────────────
          if (id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'vendor-react';
          }
          // ── React ecosystem (react-router, zustand, tanstack) ────────────
          if (id.includes('node_modules/@tanstack/') ||
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/zustand/')) {
            return 'vendor-react-ecosystem';
          }
          // ── Workflow graph (static dep of WorkflowRunPage) ───────────────
          // F6 fix: @xyflow/react MUST NOT be in lazy-diff because
          // WorkflowRunPageV2 → PipelineFlow → @xyflow/react is a static import
          // chain. Putting it in lazy-diff would make lazy-diff a static dep of
          // the workflow page, defeating lazy loading for every workflow visitor.
          if (id.includes('node_modules/@xyflow/')) {
            return 'vendor-workflow';
          }
          // ── Diff / code display (lazy — only loaded on diff views) ───────
          //
          // W28 — `src/components/diff/` used to be pinned into this bucket
          // too, alongside these two workspace packages. That was the actual
          // cause of the "4x over budget" bundle regression, and it had
          // nothing to do with WHERE <DiffProviders> was mounted: DiffCodeView,
          // DiffProviders, ChangesSurface, etc. import ordinary app
          // foundation — `useTheme()` from providers/ThemeProvider.tsx,
          // lucide-react icons, design-tokens theme data, PlatformProvider,
          // client-runtime — that the always-eager App.tsx ALSO needs. Pinning
          // our own source files into a named manual chunk stops Rollup from
          // running its normal "this module is needed by the entry too, so
          // bundle it there" heuristic; instead it bundled ~550 shared modules
          // (including ThemeProvider itself) INTO 'lazy-diff', and the entry
          // then had to statically import them back out — dragging the whole
          // pinned chunk, and everything IT statically imports (including
          // @pierre/diffs and the entire Shiki grammar set below), into the
          // eager bundle regardless of where any component was mounted.
          //
          // `packages/changes/`/`packages/review/` are real workspace
          // packages, not app source under this app's own module graph, so
          // they don't share that entanglement risk — a future consumer of
          // either would pull in its own copy of shared app foundation, not
          // reach back into this app's `src/providers/`. Left pinned for the
          // cache-stability this bucket exists for. Our own diff components
          // are deliberately NOT listed here: leaving them unassigned lets
          // Rollup's default algorithm split them correctly, which is exactly
          // what already works correctly for every other lazy page in this
          // app (see the DashboardPage/ChatPage/etc. chunks below).
          if (id.includes('packages/changes/') ||
              id.includes('packages/review/')) {
            return 'lazy-diff';
          }
          // ── Syntax highlighting (CodeMirror) ─────────────────────────────
          //
          // Shiki is deliberately NOT here. `shiki`'s bundle entry registers
          // every grammar through a dynamic `import()` so Rollup can emit one
          // small chunk per language and load only the ones a diff needs.
          // Grouping `node_modules/shiki/` and `@shikijs/` into this chunk
          // collapsed all ~200 grammars into a single 9.6 MB (1.68 MB gzip)
          // file that the first diff view downloaded and parsed whole — the
          // curated-grammar fix for highlight.js never reached the diff path
          // because of this one rule. Let Rollup split it.
          if (id.includes('node_modules/@codemirror/')) {
            return 'vendor-highlight';
          }
          // ── Heavy markdown libs (rarely change) ──────────────────────────
          if (id.includes('node_modules/marked') ||
              id.includes('node_modules/remark') ||
              id.includes('node_modules/rehype') ||
              id.includes('node_modules/unified') ||
              id.includes('node_modules/micromark')) {
            return 'vendor-markdown';
          }
          // ── xterm.js / terminal (only in TerminalPanel) ──────────────────
          if (id.includes('node_modules/@xterm/') ||
              id.includes('node_modules/xterm')) {
            return 'vendor-terminal';
          }
          // Let Rollup split everything else by its own heuristics.
          return undefined;
        },
      },
    },
  },
});
