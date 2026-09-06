// ────────────────────────────────────────────────────────────────
// safeJsonColumn — Phase 2, 2.18
// Validates JSON-column reads against a Zod schema so corrupted rows
// fail loudly at the repository boundary instead of leaking malformed
// shapes into service code. Use in `mapRow` helpers.
// ────────────────────────────────────────────────────────────────

import type { ZodType } from 'zod';

/**
 * Called whenever a stored JSON column fails validation and a default is
 * substituted in its place.
 */
export type InvalidJsonColumnReporter = (error: unknown, rawValue: unknown) => void;

let defaultReporter: InvalidJsonColumnReporter = (error) => {
  // Deliberately `warn` on the console when nothing better is wired: silence
  // is the failure mode this exists to end. The server replaces this at boot.
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[db] stored JSON column failed validation; substituting the default — ${message}`);
};

/**
 * Install the process-wide reporter for substituted JSON columns.
 *
 * Review 6.6: when a stored value does not match what the code expects, the
 * reader quietly substitutes a default — and the next unrelated save writes
 * that default back permanently, so the real value is gone. The optional
 * `onInvalid` hook that would have made this visible was passed at **0 of 59**
 * call sites, which is why nobody ever saw it happen.
 *
 * Making the DEFAULT observable fixes all 59 at once, rather than asking every
 * future `mapRow` to remember a hook. Call sites may still pass their own
 * `onInvalid` when they can say something more specific.
 */
export function setInvalidJsonColumnReporter(reporter: InvalidJsonColumnReporter): void {
  defaultReporter = reporter;
}

/**
 * Validate a JSON-column value against a Zod schema. Drizzle hands us the
 * already-parsed JS value, so we validate in-memory rather than re-parsing.
 *
 * On failure this REPORTS — via the caller's `onInvalid` hook, else the
 * process-wide reporter — and returns `fallback`. Returning `undefined`,
 * the common fallback for nullable JSON columns, keeps callers'
 * null-coalescing (`?? defaultValue`) logic working.
 */
export function safeJsonColumn<T>(
  value: unknown,
  schema: ZodType<T>,
  opts?: {
    fallback?: T | undefined;
    onInvalid?: InvalidJsonColumnReporter;
  },
): T | undefined {
  if (value === null || value === undefined) return opts?.fallback;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // No silent path: a substitution is always reported somewhere.
  (opts?.onInvalid ?? defaultReporter)(result.error, value);
  return opts?.fallback;
}
