// ────────────────────────────────────────────────────────────────
// backgroundFetch — the authenticated fetch, reachable outside React.
//
// `useAuth().fetch` is the ONLY signed fetch in the app and it lives in a
// React context. Two callers cannot reach it that way:
//
//   * a lock-screen notification action ("Allow" / "Deny") that must POST a
//     decision while the app is in the background and no screen is mounted
//     to hand a hook value to;
//   * anything else that runs off the React tree (a future background task).
//
// `AuthProvider` registers its fetch here whenever the runtime is built or
// replaced, and unregisters when it unmounts. Nothing else writes this.
// Callers must handle `null` — before restore finishes, or after unpairing,
// there is no credential to sign with and the caller falls back to opening
// the app.
// ────────────────────────────────────────────────────────────────

export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

let current: AuthenticatedFetch | null = null;

/** Called by AuthProvider only. */
export function registerAuthenticatedFetch(fetchImpl: AuthenticatedFetch | null): void {
  current = fetchImpl;
}

/** The signed fetch, or null when the app is not (yet) paired. */
export function getAuthenticatedFetch(): AuthenticatedFetch | null {
  return current;
}
