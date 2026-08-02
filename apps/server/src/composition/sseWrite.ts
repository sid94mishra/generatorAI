// ────────────────────────────────────────────────────────────────
// sseWrite — backpressure-aware SSE frame writer
//
// `res.write()` returns `false` when the socket buffer is full. Before
// Phase 1 the server ignored that and kept pushing; a single slow client
// would accumulate events in Node's internal writableBuffer until OOM.
//
// This helper:
//   - writes the frame,
//   - if `res.write()` returns `false`, waits for the `'drain'` event
//     (with a ceiling) before returning so the caller can throttle,
//   - returns a boolean indicating whether the client is healthy.
// ────────────────────────────────────────────────────────────────

import type { Response } from 'express';

export interface SSEWriteOptions {
  /** Max ms to wait for a slow client's socket to drain. Default 5s. */
  drainTimeoutMs?: number;
}

export async function writeSSEFrame(
  res: Response,
  frame: string,
  options?: SSEWriteOptions,
): Promise<boolean> {
  if (res.closed || res.destroyed) return false;

  let ok: boolean;
  try {
    ok = res.write(frame);
  } catch {
    return false;
  }
  if (ok) return true;

  // Slow consumer: wait for drain (but don't block forever).
  const drainMs = options?.drainTimeoutMs ?? 5_000;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      res.off('drain', onDrain);
      resolve(false);
    }, drainMs);
    const onDrain = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    res.once('drain', onDrain);
    // If the client disconnects during drain, abandon immediately.
    res.once('close', () => {
      clearTimeout(timer);
      res.off('drain', onDrain);
      resolve(false);
    });
  });
}
