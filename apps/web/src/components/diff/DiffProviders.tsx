// ────────────────────────────────────────────────────────────────
// DiffProviders — one worker pool + one theme for every diff surface
// ────────────────────────────────────────────────────────────────
//
// Mounted at each diff/code-view surface's own point of use (ChangesSurface,
// FilesSurface, FileViewerModal, CodebaseDetailPage) rather than once at the
// app root. Every `<CodeView>` / `<FileDiff>` nested underneath automatically:
//   • offloads Shiki syntax highlighting to a pool of 8 Web Workers, so a
//     10k-line diff never blocks the main thread;
//   • shares an LRU AST cache keyed by our blob-pair `cacheKey`, so
//     re-opening a file it already rendered is instant;
//   • follows the app's light/dark theme.
//
// W28 — this used to be mounted once, unconditionally, at the app root
// (`App.tsx`), specifically to dodge a React reconciliation trap: inserting a
// provider ABOVE an already-mounted, stateful subtree changes the element
// type at that position, and React does not reconcile across a changed type
// — it unmounts and remounts everything below, destroying route state and
// every live SSE/WebSocket subscription. But mounting at the root also forces
// Vite to bundle `@pierre/diffs/react` (and its worker/Shiki/WASM payload)
// into the eager entry chunk, even for a session that never opens a diff.
//
// The fix is NOT "move the one provider somewhere else" — it's mounting one
// `<DiffProviders>` per consumer, at that consumer's OWN initial render, so
// there is never an existing subtree to insert above. Each consuming page is
// already behind `React.lazy()` (see router.tsx), so its `<DiffProviders>`
// wrap ships in that route's own lazy chunk instead of the eager one, and
// mounts fresh alongside the page rather than retrofitting an ancestor onto
// something already on screen.
//
// This only works because `WorkerPoolContextProvider` (verified in
// `@pierre/diffs/react`'s own source) builds its pool via
// `getOrCreateWorkerPoolSingleton()`, a true module-level singleton with
// reference counting: the first mount anywhere in the app creates the pool,
// every later mount reuses it, and it is torn down only once the last
// consumer unmounts. Four independent mount points therefore still share
// exactly one Shiki/WASM worker pool and one AST cache — the property the
// original root-mount comment relied on ("multiple providers share one
// pool") — without paying for it before any of them has rendered.
//
// The other half of the original fix still applies: `PRELOAD_LANGS` stays
// empty so no worker compiles a TextMate grammar until a diff actually needs
// it, regardless of which consumer created the pool.

import { useEffect, type ReactNode } from 'react';
import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react';
import { useTheme } from '@/providers/ThemeProvider.js';
import { diffWorkerFactory } from './diffWorkerFactory.js';
import { DIFF_THEMES } from './diffTheme.js';

/**
 * Languages preloaded into every worker at construction time.
 *
 * P1-52 — this list used to hold 16 grammars, each compiled in each of 8
 * workers during app start, for every user on every page, when only the diff
 * surfaces ever read them. Empty means the workers start idle and the library
 * loads a file's grammar on first use, costing one frame of plain text on the
 * first render of each language. That frame is paid by the person looking at a
 * diff, not by everyone opening the app.
 */
const PRELOAD_LANGS: string[] = [];

/** Keeps the worker pool's theme in sync with the app theme. */
function DiffThemeSync() {
  const workerPool = useWorkerPool();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!workerPool) return;
    // NOTE: changing render options clears the AST cache and forces every
    // mounted diff to re-render, so only do it when the theme really moved.
    void workerPool.setRenderOptions({
      theme: DIFF_THEMES,
      // Keep long minified lines from destroying render time.
      maxLineDiffLength: 1000,
      tokenizeMaxLineLength: 1000,
    });
  }, [workerPool, resolvedTheme]);

  return null;
}

export function DiffProviders({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: diffWorkerFactory,
        // 8 is the library default. More workers = more parallelism but also
        // more memory, and past a point contention makes it slower.
        poolSize: 8,
        // Two LRU caches (files + diffs) of this size each.
        totalASTLRUCacheSize: 200,
      }}
      highlighterOptions={{
        theme: DIFF_THEMES,
        langs: PRELOAD_LANGS,
        maxLineDiffLength: 1000,
        tokenizeMaxLineLength: 1000,
      }}
    >
      <DiffThemeSync />
      {children}
    </WorkerPoolContextProvider>
  );
}
