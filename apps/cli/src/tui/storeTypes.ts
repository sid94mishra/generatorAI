// Re-export shim for the TUI store.
//
// `launch.tsx` needs both the store and the persisted-file shape; keeping the
// file type here rather than in `store.ts` stops the store module from having
// to know anything about disk.

export {
  createTuiStore,
  deserialiseWorkbench,
  serialiseWorkbench,
  getStore,
  setStore,
  StreamReconciler,
  useActions,
  useTui,
  type TuiActions,
  type TuiState,
  type TuiStore,
} from './store.js';

import type { serialiseWorkbench } from './store.js';

export interface SerialisedWorkbenchFile {
  workbench: ReturnType<typeof serialiseWorkbench>;
  history: string[];
  savedAt: number;
}
