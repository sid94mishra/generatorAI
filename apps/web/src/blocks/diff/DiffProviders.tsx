// ────────────────────────────────────────────────────────────────
// DiffProviders — one worker pool + one theme for every diff surface
// ────────────────────────────────────────────────────────────────
//
// Mounted at each diff/code-view surface's own point of use (the Changes
// panel, the Files dock, the file viewer, CodebaseDetailPage) rather than once
// at the app root. Every `<CodeView>` / `<FileDiff>` nested underneath:
//   • offloads Shiki syntax highlighting to a pool of 8 Web Workers, so a
//     10k-line diff never blocks the main thread;
//   • shares an LRU AST cache keyed by our blob-pair `cacheKey`, so
//     re-opening a file it already rendered is instant;
//   • highlights with the `var(--syntax-*)` theme (./diffTheme.ts), which
//     follows the app theme through CSS alone.
//
// W28 — mounting at the root forced Vite to bundle `@pierre/diffs/react` (and
// its worker/Shiki/WASM payload) into the eager entry chunk, and inserting a
// provider ABOVE an already-mounted subtree later would remount everything
// below it (React does not reconcile across a changed element type). Mounting
// one `<DiffProviders>` per consumer, at that consumer's own initial render,
// avoids both: each consumer is behind `React.lazy()`, so the provider ships
// in that route's chunk and there is never an existing subtree to insert
// above.
//
// This works because `WorkerPoolContextProvider` builds its pool through
// `getOrCreateWorkerPoolSingleton()`, a module-level, reference-counted
// singleton: the first mount creates the pool, later mounts reuse it, and it
// is torn down only when the last consumer unmounts. Several mount points
// still share exactly one Shiki/WASM worker pool and one AST cache.
//
// `PRELOAD_LANGS` stays empty so no worker compiles a TextMate grammar until
// a diff actually needs it (P1-52).

import { useEffect, type ReactNode } from 'react';
import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react';
import './diffSyntaxTheme.js';
import { diffWorkerFactory } from './diffWorkerFactory.js';
import { DIFF_THEMES } from './diffTheme.js';

/**
 * Languages preloaded into every worker at construction time. Empty: the
 * workers start idle and load a file's grammar on first use, costing one frame
 * of plain text on the first render of each language — paid by the person
 * looking at a diff, not by everyone opening the app.
 */
const PRELOAD_LANGS: string[] = [];

/** Long minified lines must not destroy render time. */
const MAX_LINE_LENGTH = 1000;

/**
 * Pins the pool's render options once. The theme's colours are CSS variables,
 * so an app theme switch needs no call here — which matters, because changing
 * render options clears the AST cache and re-renders every mounted diff.
 */
function DiffRenderOptions() {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) return;
    void workerPool.setRenderOptions({
      theme: DIFF_THEMES,
      maxLineDiffLength: MAX_LINE_LENGTH,
      tokenizeMaxLineLength: MAX_LINE_LENGTH,
    });
  }, [workerPool]);

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
        maxLineDiffLength: MAX_LINE_LENGTH,
        tokenizeMaxLineLength: MAX_LINE_LENGTH,
      }}
    >
      <DiffRenderOptions />
      {children}
    </WorkerPoolContextProvider>
  );
}
