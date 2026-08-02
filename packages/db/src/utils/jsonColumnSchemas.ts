// ────────────────────────────────────────────────────────────────
// jsonColumnSchemas — shared Zod schemas for JSON columns
//
// CLN-06 — `safeJsonColumn` needs a Zod schema per call site. Most of our
// JSON columns are loosely-typed (`Record<string, unknown>`, `unknown[]`,
// `string[]`, or pass-through `unknown`). Centralising the lenient schemas
// here avoids duplicating `z.unknown()`/`z.record(z.unknown())` inline in
// every `mapRow`. When a domain gets a stricter Zod schema (e.g. from
// `packages/shared/src/config/*`), repositories can switch to that without
// touching this file — it is purely the fallback-safety layer.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

/** Any JSON object (use as a permissive fallback for `Record<string, unknown>`) */
export const jsonRecord = z.record(z.string(), z.unknown());

/** Any JSON array (use when the column is `unknown[]`) */
export const jsonArray = z.array(z.unknown());

/** Array of strings */
export const stringArray = z.array(z.string());

/** Pass-through for genuinely untyped payloads — still traps non-JSON primitives */
export const jsonUnknown: z.ZodType<unknown> = z.unknown();

/** Array of objects */
export const objectArray = z.array(z.record(z.string(), z.unknown()));
