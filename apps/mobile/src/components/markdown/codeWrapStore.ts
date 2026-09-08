// ────────────────────────────────────────────────────────────────
// Code wrap preference.
//
// One switch for every code block on screen, not one per block: a reader
// who wants wrapped code wants it in the next block too, and a transcript
// where half the blocks scroll and half wrap is worse than either.
//
// Module-level state with a subscriber set so `useSyncExternalStore` can
// re-render every mounted block on toggle; persisted through the generic
// prefs API so the choice survives a relaunch.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

import { prefs } from '../../storage/prefs';

const KEY = 'generatorai.code-wrap';

let wrap: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (wrap === null) {
    // MMKV is synchronous, but the module may be evaluated in an environment
    // without native storage (web preview, tests); default rather than throw.
    try {
      wrap = prefs.getBoolean(KEY, false);
    } catch {
      wrap = false;
    }
  }
  return wrap;
}

export function getCodeWrap(): boolean {
  return read();
}

export function setCodeWrap(next: boolean): void {
  if (read() === next) return;
  wrap = next;
  try {
    prefs.setBoolean(KEY, next);
  } catch {
    // Persistence is best-effort; the in-memory value still applies.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCodeWrap(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
