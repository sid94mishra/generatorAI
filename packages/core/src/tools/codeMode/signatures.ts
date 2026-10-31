// ────────────────────────────────────────────────────────────────
// Code mode signatures (D-182): a tool's JSON Schema as a compact
// TypeScript-style signature, so the `run_code` description can list what
// `tools.<name>(args)` takes without repeating every schema in full.
//
//   open_page(args: {url: string; newTab?: boolean}): Promise<unknown> — Open a page.
//
// Deliberately lossy: nested objects collapse to `object` past a depth, long
// unions and property lists are cut with `…`, and formats/patterns/bounds are
// dropped. The tool's own handler still validates its arguments.
// ────────────────────────────────────────────────────────────────

type Schema = Record<string, unknown>;

export interface SignatureOptions {
  /** Object nesting rendered in full; deeper objects read `object`. Default 2. */
  maxDepth?: number;
  /** A signature longer than this is re-rendered shallower, then cut. Default 320. */
  maxChars?: number;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_UNION = 8;

function asSchema(v: unknown): Schema | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Schema) : undefined;
}

function literal(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

function union(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.includes('unknown')) return 'unknown';
  const shown = unique.length > MAX_UNION ? [...unique.slice(0, MAX_UNION), '…'] : unique;
  return shown.join(' | ');
}

/** A property key as TypeScript would write it. */
export function propertyKey(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

/** One JSON Schema as a TypeScript-style type expression. */
export function schemaToType(schemaIn: unknown, depth = 0, maxDepth = 2): string {
  const schema = asSchema(schemaIn);
  if (!schema) return schemaIn === false ? 'never' : 'unknown';

  if ('const' in schema) return literal(schema['const']);
  if (Array.isArray(schema['enum'])) return union((schema['enum'] as unknown[]).map(literal));
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[key])) {
      return union((schema[key] as unknown[]).map((s) => schemaToType(s, depth, maxDepth)));
    }
  }
  if (Array.isArray(schema['allOf'])) {
    const parts = (schema['allOf'] as unknown[]).map((s) => schemaToType(s, depth, maxDepth));
    return parts.length === 1 ? parts[0]! : parts.join(' & ');
  }

  const type = schema['type'];
  if (Array.isArray(type)) {
    return union(type.map((t) => schemaToType({ ...schema, type: t }, depth, maxDepth)));
  }
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const items = schema['items'];
      if (Array.isArray(items)) return `[${items.map((s) => schemaToType(s, depth + 1, maxDepth)).join(', ')}]`;
      const inner = schemaToType(items, depth + 1, maxDepth);
      return /[|&\s]/.test(inner) && !inner.startsWith('{') ? `(${inner})[]` : `${inner}[]`;
    }
    case 'object':
      return objectType(schema, depth, maxDepth);
    default:
      if (asSchema(schema['properties'])) return objectType(schema, depth, maxDepth);
      return 'unknown';
  }
}

function objectType(schema: Schema, depth: number, maxDepth: number): string {
  const props = asSchema(schema['properties']);
  const extra = schema['additionalProperties'];
  if (!props || Object.keys(props).length === 0) {
    const value = asSchema(extra);
    return value ? `Record<string, ${schemaToType(value, depth + 1, maxDepth)}>` : 'object';
  }
  if (depth >= maxDepth) return 'object';
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  const fields = Object.entries(props).map(
    ([key, value]) => `${propertyKey(key)}${required.has(key) ? '' : '?'}: ${schemaToType(value, depth + 1, maxDepth)}`,
  );
  return `{${fields.join('; ')}}`;
}

/** The first line of a description, clipped. */
export function firstLine(description: string | undefined, max = 140): string {
  const line = (description ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `name(args: {...}): Promise<unknown>` for one tool. */
export function toolSignature(name: string, parametersSchema: unknown, opts: SignatureOptions = {}): string {
  const maxChars = opts.maxChars ?? 320;
  const head = IDENT.test(name) ? name : `[${JSON.stringify(name)}]`;
  const render = (depth: number) => {
    const t = schemaToType(parametersSchema ?? { type: 'object' }, 0, depth);
    const args = t === 'object' || t === 'unknown' ? 'args?: object' : `args: ${t}`;
    return `${head}(${args}): Promise<unknown>`;
  };
  for (let depth = opts.maxDepth ?? 2; depth >= 1; depth -= 1) {
    const sig = render(depth);
    if (sig.length <= maxChars) return sig;
  }
  const sig = render(1);
  const tail = '…}): Promise<unknown>';
  return `${sig.slice(0, maxChars - tail.length)}${tail}`;
}

export interface ListingEntry {
  name: string;
  description: string;
  parametersSchema: unknown;
}

/**
 * The tool listing for the `run_code` description: one signature line per
 * tool with the first line of its description, up to `maxChars` in total; the
 * rest are named only (still callable).
 */
export function renderToolListing(entries: readonly ListingEntry[], maxChars = 12_000): string {
  const lines: string[] = [];
  let used = 0;
  let i = 0;
  for (; i < entries.length; i += 1) {
    const e = entries[i]!;
    const desc = firstLine(e.description);
    const line = `- ${toolSignature(e.name, e.parametersSchema)}${desc ? ` — ${desc}` : ''}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (i < entries.length) {
    const rest = entries.slice(i).map((e) => e.name);
    lines.push(`- … and ${rest.length} more (see their own tool descriptions): ${rest.join(', ')}`);
  }
  return lines.join('\n');
}
