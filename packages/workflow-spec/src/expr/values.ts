// ────────────────────────────────────────────────────────────────
// Run-time values of Expression v2: JSON values. Equality is strict by
// JSON type and deep for lists and objects.
// ────────────────────────────────────────────────────────────────

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

/** Normalise anything to a JSON value (`undefined` and non-JSON become null). */
export function toValue(v: unknown, depth = 0): Value {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v;
    case 'number':
      return Number.isFinite(v) ? v : null;
    case 'object': {
      if (depth > 64) return null;
      if (Array.isArray(v)) return v.map((x) => toValue(x, depth + 1));
      if (v instanceof Date) return v.toISOString();
      const out: { [key: string]: Value } = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (x !== undefined) out[k] = toValue(x, depth + 1);
      }
      return out;
    }
    default:
      return null;
  }
}

export function isObjectValue(v: unknown): v is { [key: string]: Value } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Own-property read; never walks the prototype chain (`__proto__`, `constructor`). */
export function getField(obj: unknown, key: string): Value {
  if (!isObjectValue(obj)) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const v = obj[key];
  return v === undefined ? null : v;
}

export function deepEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i]!, b[i]!)) return false;
    return true;
  }
  if (isObjectValue(a)) {
    if (!isObjectValue(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k]!, b[k]!)) return false;
    }
    return true;
  }
  return false;
}

/** JSON with keys sorted at every level: stable text for hashing and diffing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}
