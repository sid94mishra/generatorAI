// ────────────────────────────────────────────────────────────────
// restoreState — what a cold start does when the stored session cannot be
// READ, as opposed to not existing.
//
// The session item lives in the Keychain / Keystore with a "when unlocked"
// accessibility class (see `secureItemStore.ts`). iOS can launch the app
// while the phone is still locked — a notification action, a background
// wake — and then every read of that item rejects with
// `errSecInteractionNotAllowed`. That rejection used to escape the restore
// effect, leaving auth at its initial `unpaired`, and the route gate sent an
// already-paired user to /pair. The same happens on Android when the
// Keystore is momentarily unavailable.
//
// "I could not read it" is not "there is nothing there". This module is the
// pure state logic that keeps those apart; `AuthProvider` drives it.
//
// Pure: no React Native / Expo imports, unit-tested on node.
// ────────────────────────────────────────────────────────────────

/**
 * `restoring`  reading the session / initialising the runtime
 * `locked`     protected storage refused the read; wait for the user to
 *              unlock and bring the app forward, then try again
 * `settled`    restore finished (paired or not — `AuthState` says which)
 */
export type RestorePhase = 'restoring' | 'locked' | 'settled';

export type RestoreEvent =
  | { type: 'retry' }
  | { type: 'storage-unavailable' }
  | { type: 'settled' };

export function nextRestorePhase(phase: RestorePhase, event: RestoreEvent): RestorePhase {
  switch (event.type) {
    case 'retry':
      // Only a locked restore is retried; a settled one never restarts on
      // its own (that would re-run pairing checks on every foreground).
      return phase === 'locked' ? 'restoring' : phase;
    case 'storage-unavailable':
      return 'locked';
    case 'settled':
      return 'settled';
    default:
      return phase;
  }
}

/** Retry a locked restore when the app becomes active (the user unlocked). */
export function shouldRetryRestore(phase: RestorePhase, appState: string): boolean {
  return phase === 'locked' && appState === 'active';
}

/** The route gate must neither route nor render screens until this is false. */
export function isRestorePending(phase: RestorePhase): boolean {
  return phase !== 'settled';
}

/**
 * Whether an error thrown while reading key material means protected storage
 * is unavailable right now (device locked, Keystore busy) rather than that
 * the data is missing or the server said no.
 *
 * Deliberately recognises only storage errors: a network failure or a
 * credential rejection must keep reaching the existing error screens.
 */
export function isStorageUnavailableError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : '';
  return STORAGE_UNAVAILABLE.test(message);
}

const STORAGE_UNAVAILABLE =
  /interaction is not allowed|errSecInteractionNotAllowed|-25308|keychain|keystore|secure ?store|device is locked|user not authenticated|protected data/i;
