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

import { useEffect, type ReactNode } from 'react';
import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react';
import { useTheme } from '@/providers/ThemeProvider.js';
import { diffWorkerFactory } from './diffWorkerFactory.js';
import { DIFF_THEMES } from './diffTheme.js';

/**
 * Languages preloaded into every worker. Anything not listed still works —
 * it just loads lazily on first use, costing one frame of plain text.
 */
const PRELOAD_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'markdown',
  'python',
  'bash',
  'yaml',
  'css',
  'html',
  'sql',
  'go',
  'rust',
  'java',
  'csharp',
];

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
