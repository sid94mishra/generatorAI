// ────────────────────────────────────────────────────────────────
// validateJsonColumn — DB-03 (write-side companion to safeJsonColumn)
//
// CLN-06 added `safeJsonColumn` to guard **reads** of JSON columns. DB-03
// closes the loop by guarding **writes**: insert/update paths use
// `validateJsonColumn(value, schema)` to fail loudly if a malformed payload
// would otherwise slip into the DB as corrupt JSON. Pair the same Zod
// schemas used in `mapRow` for symmetry — what we read back we must be
// willing to write.
//
// Unlike `safeJsonColumn` (which returns a fallback on bad shape because
// reads happen in loops and one bad row shouldn't kill a list request),
// this helper THROWS. Writes should fail the request with a 400/500, never
// silently persist garbage.
// ────────────────────────────────────────────────────────────────

import type { ZodType } from 'zod';

export class JsonColumnValidationError extends Error {
  readonly code = 'JSON_COLUMN_VALIDATION';
  readonly column: string;
  readonly issues: unknown;

  constructor(column: string, issues: unknown, tableHint?: string) {
    const tbl = tableHint ? ` on ${tableHint}` : '';
    super(`JSON column \`${column}\`${tbl} failed validation at write`);
    this.name = 'JsonColumnValidationError';
    this.column = column;
    this.issues = issues;
  }
}

/**
 * Validate a value destined for a JSON column. Returns the parsed value
 * (so callers can use the refined type) on success; throws
 * `JsonColumnValidationError` on failure.
 *
 * `null` / `undefined` pass through unchanged — most JSON columns are
 * nullable, and forcing callers to branch around null defeats the helper's
 * ergonomics. Tighten with `.nullable()` in the schema if null is invalid.
 */
export function validateJsonColumn<T>(
  value: unknown,
  schema: ZodType<T>,
  opts?: { column: string; table?: string },
): T | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new JsonColumnValidationError(
      opts?.column ?? 'unknown',
      result.error.issues,
      opts?.table,
    );
  }
  return result.data;
}
