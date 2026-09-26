// ────────────────────────────────────────────────────────────────
// Pierre worker factory — Vite-specific
// ────────────────────────────────────────────────────────────────
//
// Every bundler needs its own way to construct the Shiki highlight worker.
// Vite's `?worker&url` suffix emits the worker as a separate chunk and gives
// us its URL, which is the officially supported Vite recipe.
//
// `vite.config.ts` sets `worker.format: 'es'` — required, because the worker
// bundle uses ES module syntax.

import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

export function diffWorkerFactory(): Worker {
  return new Worker(WorkerUrl, { type: 'module' });
}
