// ────────────────────────────────────────────────────────────────
// useIdempotencyKey — the key a run-start form sends with its invocation.
//
// One key covers one intent to start a run: a double tap or a network retry
// sends the same key, so the server replays the run it already started
// instead of starting a second one. The key is replaced once the server has
// answered (a run started, or a refusal, which started nothing) so the next
// press, possibly with different inputs, is a new intent rather than a 409.
// A network failure keeps the key: the request may have landed.
// ────────────────────────────────────────────────────────────────

import { useMemo, useRef } from 'react';
import { ApiError, newIdempotencyKey } from '@generatorai/client-core';

export interface IdempotencyKey {
  /** The key for the next request. */
  get: () => string;
  /** Start a new intent (e.g. the form was opened again). */
  rotate: () => void;
  /** Call when the request settles; keeps the key only after a network failure. */
  settle: (err?: unknown) => void;
}

export function useIdempotencyKey(): IdempotencyKey {
  const key = useRef<string>(newIdempotencyKey());
  return useMemo(() => {
    const rotate = (): void => {
      key.current = newIdempotencyKey();
    };
    return {
      get: () => key.current,
      rotate,
      settle: (err?: unknown) => {
        if (err === undefined || err instanceof ApiError) rotate();
      },
    };
  }, []);
}
