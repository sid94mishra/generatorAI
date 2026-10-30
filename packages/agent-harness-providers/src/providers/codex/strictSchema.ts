// ────────────────────────────────────────────────────────────────
// Codex structured output runs on OpenAI's strict JSON-schema mode, which
// rejects (HTTP 400, "additionalProperties is required to be supplied and to
// be false when strict is true") any object that is open or leaves a property
// optional — the stock templates' stage schemas do both, so every Codex stage
// with a JSON output failed at once ("The Codex thread entered a system error
// state"). The schema sent is made strict: each object closes and requires
// all of its properties, and a property the stage left optional may be null.
// The answer's nulls for those are dropped again, so the stage's own schema
// still validates it.
// ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `child`, also accepting null. */
function nullable(child: unknown): unknown {
  if (!isObject(child)) return child;
  const out: Json = { ...child };
  if (Array.isArray(out['anyOf'])) {
    const branches = out['anyOf'] as unknown[];
    if (!branches.some((b) => isObject(b) && b['type'] === 'null')) out['anyOf'] = [...branches, { type: 'null' }];
    return out;
  }
  if (Array.isArray(out['enum']) && !(out['enum'] as unknown[]).includes(null)) out['enum'] = [...(out['enum'] as unknown[]), null];
  const t = out['type'];
  if (typeof t === 'string') out['type'] = t === 'null' ? t : [t, 'null'];
  else if (Array.isArray(t)) out['type'] = t.includes('null') ? t : [...t, 'null'];
  else if (!Array.isArray(out['enum'])) return { anyOf: [out, { type: 'null' }] };
  return out;
}

/** The strict-mode form of a JSON schema (see the file header). */
export function toStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!isObject(schema)) return schema;
  const out: Json = { ...schema };
  for (const key of ['anyOf', 'allOf'] as const) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(toStrictSchema);
  }
  // Strict mode has no oneOf; anyOf accepts the same answers for disjoint branches.
  if (Array.isArray(out['oneOf'])) {
    out['anyOf'] = (out['oneOf'] as unknown[]).map(toStrictSchema);
    delete out['oneOf'];
  }
  if (out['items'] !== undefined) out['items'] = toStrictSchema(out['items']);
  for (const key of ['$defs', 'definitions'] as const) {
    if (isObject(out[key])) out[key] = Object.fromEntries(Object.entries(out[key] as Json).map(([k, v]) => [k, toStrictSchema(v)]));
  }
  const isObjectSchema = out['type'] === 'object' || (Array.isArray(out['type']) && (out['type'] as unknown[]).includes('object')) || isObject(out['properties']);
  if (isObjectSchema) {
    const props = isObject(out['properties']) ? (out['properties'] as Json) : {};
    const required = new Set(Array.isArray(out['required']) ? (out['required'] as string[]) : []);
    out['properties'] = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, required.has(k) ? toStrictSchema(v) : nullable(toStrictSchema(v))]),
    );
    out['required'] = Object.keys(props);
    out['additionalProperties'] = false;
  }
  return out;
}

/** Removes the nulls strict mode put where the original schema left a property optional. */
export function dropOptionalNulls(value: unknown, schema: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) return schema['items'] !== undefined ? value.map((v) => dropOptionalNulls(v, schema['items'])) : value;
  if (!isObject(value) || !isObject(schema['properties'])) return value;
  const props = schema['properties'] as Json;
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  const out: Json = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !required.has(k)) continue;
    out[k] = k in props ? dropOptionalNulls(v, props[k]) : v;
  }
  return out;
}
