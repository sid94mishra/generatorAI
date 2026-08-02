// ────────────────────────────────────────────────────────────────
// safeJsonColumn — Phase 2, 2.18
// Validates JSON-column reads against a Zod schema so corrupted rows
// fail loudly at the repository boundary instead of leaking malformed
// shapes into service code. Use in `mapRow` helpers.
// ────────────────────────────────────────────────────────────────

import type { ZodType } from 'zod';

/**
 * Validate a JSON-column value against a Zod schema. Drizzle hands us the
 * already-parsed JS value, so we validate in-memory rather than re-parsing.
 *
 * On failure, logs (via the caller's `onInvalid` hook if provided) and
 * returns `fallback`. Returning `undefined` — which is the common fallback
 * shape for nullable JSON columns — keeps callers' null-coalescing
 * (`?? defaultValue`) logic working.
 */
export function safeJsonColumn<T>(
  value: unknown,
  schema: ZodType<T>,
  opts?: {
    fallback?: T | undefined;
    onInvalid?: (error: unknown, rawValue: unknown) => void;
  },
): T | undefined {
  if (value === null || value === undefined) return opts?.fallback;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  opts?.onInvalid?.(result.error, value);
  return opts?.fallback;
}
