// ────────────────────────────────────────────────────────────────
// Template filters (`{{ value | name }}`): a registry, like functions.
// ────────────────────────────────────────────────────────────────

import { kindsOf, typeToString, withoutNull, type ExprType } from './types.js';
import { isObjectValue, type Value } from './values.js';

export interface TemplateFilter {
  name: string;
  description: string;
  /** Returns a diagnostic message when the input type cannot be filtered, else null. */
  check(input: ExprType): string | null;
  apply(v: Value): string;
}

/** Default rendering of a value inside `{{ }}`: text as is, null as empty, structures as JSON. */
export function renderValue(v: Value): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

function yamlScalar(v: Value): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  const plain =
    s.length > 0 &&
    !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) &&
    !/[:#]\s|\s$|\n/.test(s) &&
    !/^(true|false|null|yes|no|on|off|~|[-+]?(\d|\.\d))/i.test(s);
  return plain ? s : JSON.stringify(s);
}

function toYaml(v: Value, indent: string): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v
      .map((item) => {
        if ((Array.isArray(item) && item.length) || (isObjectValue(item) && Object.keys(item).length)) {
          const inner = toYaml(item, `${indent}  `);
          return `${indent}- ${inner.slice(indent.length + 2)}`;
        }
        return `${indent}- ${Array.isArray(item) ? '[]' : isObjectValue(item) ? '{}' : yamlScalar(item)}`;
      })
      .join('\n');
  }
  if (isObjectValue(v)) {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    return keys
      .map((k) => {
        const item = v[k]!;
        const key = yamlScalar(k);
        if ((Array.isArray(item) && item.length) || (isObjectValue(item) && Object.keys(item).length)) {
          return `${indent}${key}:\n${toYaml(item, `${indent}  `)}`;
        }
        return `${indent}${key}: ${Array.isArray(item) ? '[]' : isObjectValue(item) ? '{}' : yamlScalar(item)}`;
      })
      .join('\n');
  }
  return `${indent}${yamlScalar(v)}`;
}

function bullet(item: Value): string {
  if (typeof item === 'string') return `- ${item}`;
  if (isObjectValue(item)) {
    const id = item['id'];
    const body = item['body'] ?? item['title'];
    if (body !== undefined && body !== null) {
      const prefix = id !== undefined && id !== null ? `[${renderValue(id)}] ` : '';
      return `- ${prefix}${renderValue(body)}`;
    }
    return `- ${JSON.stringify(item)}`;
  }
  return `- ${item === null ? 'null' : typeof item === 'object' ? JSON.stringify(item) : String(item)}`;
}

const FILTERS: TemplateFilter[] = [
  {
    name: 'json',
    description: 'Pretty-printed JSON',
    check: () => null,
    apply: (v) => JSON.stringify(v, null, 2),
  },
  {
    name: 'yaml',
    description: 'YAML',
    check: () => null,
    apply: (v) => (v === null ? '' : toYaml(v, '')),
  },
  {
    name: 'bullets',
    description: "A markdown list: strings as '- text'; objects as '- [id] body' (id, body or title), otherwise JSON",
    check(input) {
      if (input.kind === 'any') return null;
      const k = kindsOf(withoutNull(input));
      return k.has('list') || k.has('string') ? null : `bullets needs a list, got ${typeToString(input)}`;
    },
    apply(v) {
      if (v === null) return '';
      if (Array.isArray(v)) return v.map(bullet).join('\n');
      return bullet(v);
    },
  },
];

const REGISTRY = new Map(FILTERS.map((f) => [f.name, f]));

export function getFilter(name: string): TemplateFilter | undefined {
  return REGISTRY.get(name);
}

export function listFilters(): TemplateFilter[] {
  return [...REGISTRY.values()];
}

