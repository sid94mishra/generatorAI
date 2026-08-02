// ────────────────────────────────────────────────────────────────
// Activity ordering and filtering.
//
// Extracted from `useActivity` so it can be tested without React Native in
// the runner: the hook transitively imports the auth provider, which imports
// `react-native`, whose Flow-typed entry point vitest cannot parse.
//
// The rule this encodes is the entire product argument for a phone client:
// show me the one thing that is waiting on me, before anything else.
// ────────────────────────────────────────────────────────────────

export type OperationKind = 'chat' | 'run' | 'automation';

export interface Operation {
  id: string;
  kind: OperationKind;
  name: string;
  status: string;
  updatedAt: number;
  /** Route to open when tapped. */
  href: string;
  /** True when a person is blocking progress. */
  blocked: boolean;
  running: boolean;
}

export type ActivityFilter = 'today' | 'running' | 'attention';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Urgency first, then recency.
 *
 * Returns a new array — the caller's list is usually a `useMemo` input and
 * mutating it in place would make the memo lie.
 */
export function rankOperations(operations: Operation[]): Operation[] {
  return [...operations].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function filterOperations(
  operations: Operation[],
  filter: ActivityFilter,
  now = Date.now(),
): Operation[] {
  switch (filter) {
    case 'running':
      return operations.filter((op) => op.running);
    case 'attention':
      return operations.filter((op) => op.blocked);
    case 'today':
    default:
      // "Today" means the last 24h, not "since midnight": someone checking
      // their phone at 00:30 wants last night's work, not an empty list.
      return operations.filter((op) => now - op.updatedAt < DAY_MS);
  }
}
