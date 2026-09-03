// ────────────────────────────────────────────────────────────────
// globalSingleton — HMR-split-proof module state.
//
// Vite's dev server can end up serving the SAME source file under TWO URLs
// (`/src/stores/streamStore.ts` and `/src/stores/streamStore.ts?t=<hmr>`)
// when an HMR invalidation re-transforms some importers but not others.
// Each URL evaluates the module again, so a plain `export const useStore =
// create(...)` yields two independent store instances: the UI subscribes to
// one while sseManager writes tokens into the other. Live streaming appears
// completely dead even though every event arrives — observed live on
// 2026-08-31 (ChatPage held `?t=1788170129471`, sseManager held the bare
// URL, and the transcript only appeared after a refresh replay).
//
// Keying shared state on `globalThis` makes every evaluation of the module
// hand out the SAME instance, whichever URL it was served under. Production
// builds bundle to a single module where this is a no-op wrapper.
// ────────────────────────────────────────────────────────────────

interface SingletonHost {
  __generatorai_singletons?: Map<string, unknown>;
}

/**
 * Return the value registered under `key`, creating it with `create` on
 * first use. All module instances — however many URLs Vite served the file
 * under — receive the same value.
 */
export function globalSingleton<T>(key: string, create: () => T): T {
  const host = globalThis as SingletonHost;
  const registry = (host.__generatorai_singletons ??= new Map<string, unknown>());
  if (!registry.has(key)) {
    registry.set(key, create());
  }
  return registry.get(key) as T;
}
