// ────────────────────────────────────────────────────────────────
// The static types of Expression v2.
//
// Small on purpose: scalars, lists, objects (closed, or with a `rest` type
// for unknown fields), unions (mostly T | null), `any` for values whose
// shape is unknown, and `unavailable` for names that exist but cannot be
// used where they appear (a stage that is not upstream, `loop` outside a
// loop). Types come from variable declarations and from stage output JSON
// Schemas.
// ────────────────────────────────────────────────────────────────

export type ExprType =
  | { kind: 'any' }
  | { kind: 'null' }
  | { kind: 'string'; enum?: readonly string[] }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'list'; element: ExprType }
  | {
      kind: 'object';
      fields: Readonly<Record<string, ExprType>>;
      /** Type of fields not listed; absent means unknown fields are errors. */
      rest?: ExprType;
      /** Code and noun of the "unknown field" error (default expr-unknown-field, "field"). */
      unknown?: { code: string; noun: string };
    }
  | { kind: 'union'; types: readonly ExprType[] }
  | { kind: 'unavailable'; code: string; message: string; hint?: string };

export const T = {
  any: { kind: 'any' } as ExprType,
  null: { kind: 'null' } as ExprType,
  string: { kind: 'string' } as ExprType,
  number: { kind: 'number' } as ExprType,
  boolean: { kind: 'boolean' } as ExprType,
  list: (element: ExprType): ExprType => ({ kind: 'list', element }),
  object: (fields: Record<string, ExprType>, rest?: ExprType): ExprType =>
    rest ? { kind: 'object', fields, rest } : { kind: 'object', fields },
  enumOf: (values: readonly string[]): ExprType => ({ kind: 'string', enum: values }),
  unavailable: (code: string, message: string, hint?: string): ExprType =>
    hint ? { kind: 'unavailable', code, message, hint } : { kind: 'unavailable', code, message },
};

/** `t | null`, flattened. */
export function nullable(t: ExprType): ExprType {
  if (t.kind === 'any' || t.kind === 'null' || t.kind === 'unavailable') return t;
  return union([t, T.null]);
}

export function union(types: ExprType[]): ExprType {
  const flat: ExprType[] = [];
  for (const t of types) {
    if (t.kind === 'union') flat.push(...t.types);
    else flat.push(t);
  }
  if (flat.some((t) => t.kind === 'any')) return T.any;
  // `[]` unifies with the element type of the other operand (P05 §1.1): a
  // list of unknown elements next to a typed list adds nothing.
  const typedList = flat.some((t) => t.kind === 'list' && t.element.kind !== 'any');
  const out: ExprType[] = [];
  for (const t of flat) {
    if (typedList && t.kind === 'list' && t.element.kind === 'any') continue;
    if (!out.some((o) => sameType(o, t))) out.push(t);
  }
  if (out.length === 0) return T.any;
  if (out.length === 1) return out[0]!;
  return { kind: 'union', types: out };
}

function sameType(a: ExprType, b: ExprType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'string' && b.kind === 'string') {
    return JSON.stringify(a.enum ?? null) === JSON.stringify(b.enum ?? null);
  }
  if (a.kind === 'list' && b.kind === 'list') return sameType(a.element, b.element);
  if (a.kind === 'object' || a.kind === 'union' || a.kind === 'unavailable') return a === b;
  return true;
}

/** The members of a type, a union expanded. */
export function members(t: ExprType): ExprType[] {
  return t.kind === 'union' ? [...t.types] : [t];
}

export function withoutNull(t: ExprType): ExprType {
  const m = members(t).filter((x) => x.kind !== 'null');
  if (m.length === 0) return T.null;
  return m.length === 1 ? m[0]! : { kind: 'union', types: m };
}

export function isNullable(t: ExprType): boolean {
  return t.kind === 'any' || members(t).some((m) => m.kind === 'null');
}

/** Scalar kinds a type may take at run time (`any` → every kind). */
export function kindsOf(t: ExprType): Set<string> {
  if (t.kind === 'any') return new Set(['string', 'number', 'boolean', 'list', 'object', 'null']);
  return new Set(members(t).map((m) => m.kind));
}

/** Whether a value of type `t` may be a boolean or null (usable as a condition). */
export function isBooleanish(t: ExprType): boolean {
  if (t.kind === 'any') return true;
  return members(t).every((m) => m.kind === 'boolean' || m.kind === 'null');
}

export function typeToString(t: ExprType): string {
  switch (t.kind) {
    case 'any':
      return 'any';
    case 'null':
      return 'null';
    case 'string':
      return t.enum ? t.enum.map((e) => `'${e}'`).join(' | ') : 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'list':
      return `list<${typeToString(t.element)}>`;
    case 'object':
      return 'object';
    case 'union':
      return t.types.map(typeToString).join(' | ');
    case 'unavailable':
      return 'unavailable';
  }
}

/**
 * Type of a JSON Schema. Objects that declare `properties` are closed for
 * type checking unless `additionalProperties` allows more, so a typo in a
 * field name is caught at save time. Non-required properties are nullable.
 */
export function typeFromJsonSchema(schema: unknown, depth = 0): ExprType {
  if (depth > 16 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return T.any;
  const s = schema as Record<string, unknown>;
  if ('const' in s) return typeOfValue(s['const']);
  if (Array.isArray(s['enum'])) {
    const values = s['enum'] as unknown[];
    if (values.length > 0 && values.every((v) => typeof v === 'string')) return T.enumOf(values as string[]);
    return union(values.map(typeOfValue));
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(s[key])) return union((s[key] as unknown[]).map((x) => typeFromJsonSchema(x, depth + 1)));
  }
  const type = s['type'];
  if (Array.isArray(type)) {
    return union(type.map((ty) => typeFromJsonSchema({ ...s, type: ty }, depth + 1)));
  }
  switch (type) {
    case 'string':
      return T.string;
    case 'number':
    case 'integer':
      return T.number;
    case 'boolean':
      return T.boolean;
    case 'null':
      return T.null;
    case 'array':
      return T.list(s['items'] !== undefined ? typeFromJsonSchema(s['items'], depth + 1) : T.any);
    case 'object': {
      const props = s['properties'];
      if (!props || typeof props !== 'object' || Array.isArray(props)) return T.any;
      const required = new Set(Array.isArray(s['required']) ? (s['required'] as unknown[]).map(String) : []);
      const fields: Record<string, ExprType> = {};
      for (const [name, sub] of Object.entries(props as Record<string, unknown>)) {
        const ft = typeFromJsonSchema(sub, depth + 1);
        fields[name] = required.has(name) ? ft : nullable(ft);
      }
      const extra = s['additionalProperties'];
      if (extra === undefined || extra === false) return T.object(fields);
      return T.object(fields, extra === true ? T.any : typeFromJsonSchema(extra, depth + 1));
    }
    default:
      if (s['properties']) return typeFromJsonSchema({ ...s, type: 'object' }, depth + 1);
      return T.any;
  }
}

export function typeOfValue(v: unknown): ExprType {
  if (v === null || v === undefined) return T.null;
  if (typeof v === 'string') return T.string;
  if (typeof v === 'number') return T.number;
  if (typeof v === 'boolean') return T.boolean;
  if (Array.isArray(v)) return T.list(v.length > 0 ? union(v.map(typeOfValue)) : T.any);
  return T.any;
}
