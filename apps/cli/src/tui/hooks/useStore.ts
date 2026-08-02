// useStore hook — React hook that subscribes to the Zustand vanilla store

import { useSyncExternalStore, useCallback } from 'react';
import type { TUIStore, TUIStoreInstance } from '../stores/appStore.js';

// Global store reference (set by TUI entry point)
let _store: TUIStoreInstance | null = null;

export function setGlobalStore(store: TUIStoreInstance): void {
  _store = store;
}

function getStore(): TUIStoreInstance {
  if (!_store) throw new Error('TUI store not initialized');
  return _store;
}

export function useStore<T>(selector: (state: TUIStore) => T): T {
  const store = getStore();
  const subscribe = useCallback(
    (callback: () => void) => store.subscribe(callback),
    [store],
  );
  const getSnapshot = useCallback(() => selector(store.getState()), [store, selector]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useActions() {
  const store = getStore();
  return store.getState();
}
