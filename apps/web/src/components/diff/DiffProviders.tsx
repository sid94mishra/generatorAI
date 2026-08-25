// ────────────────────────────────────────────────────────────────
// DiffProviders — one worker pool + one theme for every diff surface
// ────────────────────────────────────────────────────────────────
//
// Mounted once near the app root. Every `<CodeView>` / `<FileDiff>` nested
// underneath automatically:
//   • offloads Shiki syntax highlighting to a pool of 8 Web Workers, so a
//     10k-line diff never blocks the main thread;
//   • shares an LRU AST cache keyed by our blob-pair `cacheKey`, so
//     re-opening a file it already rendered is instant;
//   • follows the app's light/dark theme.
//
// The provider tears the pool down on unmount, and multiple providers share
// one pool, so this is safe to mount defensively.
//
// P1-52 — it stays mounted at the ROOT and unconditionally. An earlier attempt
// to defer construction until the first diff render was wrong: inserting the
// provider above `children` changes the element type at that position, and
// React does not reconcile across a changed type — it would unmount and
// remount the entire routed application, destroying every route's state and
// every SSE/WebSocket subscription the first time a user opened a file.
//
// What is deferred instead is the largest part. `WorkerPoolManager`'s
// constructor calls `queueInitialization(langs)`, which compiled every
// preloaded TextMate grammar in every worker at app start. Preloading nothing
// leaves the workers idle until a diff arrives, and the library then loads the
// grammar a file actually needs on demand.
//
// STILL PAID AT ROOT, and deliberately not addressed here: the 8 workers
// themselves and the shared Shiki/WASM highlighter, because
// `WorkerPoolManager`'s constructor calls `initialize()` unconditionally and
// `CodeView` captures the pool at instance-construction time — so a pool that
// arrives later never reaches an already-mounted diff, and the first file a
// user opens would render permanently unhighlighted. Removing that cost means
// owning pool construction rather than the library's provider, which is W28's
// "diff providers mounted lazily" in Phase 5, not a Phase 0 guard clause.

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
