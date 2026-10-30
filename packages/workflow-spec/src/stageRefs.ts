// ────────────────────────────────────────────────────────────────
// Rewriting `stages.<key>` references when stages move into or out of a loop
// (D-104). Outside a loop's body a body stage's output is read through the
// loop — `stages.<loop>.output.last.<key>` is what `stages.<key>.output` was
// (validate/scope.ts) — so wrapping stages
// in a loop rewrites the references the rest of the graph makes to them, and
// unwrapping the loop rewrites them back. Expressions, prompt templates and
// any other string in a stage or an edge are rewritten alike. Other fields of
// a body stage (`stages.<key>.status` …) have no equivalent outside the body
// and are left for the validator to point out; a map body has no single-value
// equivalent (its results are a list) and is not rewritten.
// ────────────────────────────────────────────────────────────────

import type { EdgeSpec } from './schemas/edge.js';
import type { StageSpec } from './schemas/stage.js';

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply `rewrite` to every string inside a JSON-like value; unchanged values keep their identity. */
function mapStrings<T>(value: T, rewrite: (s: string) => string): T {
  if (typeof value === 'string') {
    const next = rewrite(value);
    return (next === value ? value : next) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const r = mapStrings(v, rewrite);
      if (r !== v) changed = true;
      return r;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = mapStrings(v, rewrite);
      if (r !== v) changed = true;
      next[k] = r;
    }
    return (changed ? next : value) as T;
  }
  return value;
}

/** `stages.<key>.output` → `stages.<loop>.output.last.<key>` for each body key, in one string. */
export function qualifyBodyRefsIn(text: string, loopKey: string, bodyKeys: readonly string[]): string {
  if (bodyKeys.length === 0 || !text.includes('stages.')) return text;
  // Not preceded by a word character or a dot: `stages.other.output.last.x` is not a reference to `x`.
  const re = new RegExp(`(?<![\\w.])stages\\.(${bodyKeys.map(escape).join('|')})\\.output(?!\\w)`, 'g');
  return text.replace(re, (_m, key: string) => `stages.${loopKey}.output.last.${key}`);
}

/** `stages.<loop>.output.last.<key>` → `stages.<key>.output` for each body key, in one string. */
export function unqualifyBodyRefsIn(text: string, loopKey: string, bodyKeys: readonly string[]): string {
  if (bodyKeys.length === 0 || !text.includes(`stages.${loopKey}.`)) return text;
  const re = new RegExp(`(?<![\\w.])stages\\.${escape(loopKey)}\\.output\\.last\\.(${bodyKeys.map(escape).join('|')})(?!\\w)`, 'g');
  return text.replace(re, (_m, key: string) => `stages.${key}.output`);
}

/** Every string of a stage or an edge, with the body references qualified through the loop. */
export function qualifyBodyRefs<T extends StageSpec | EdgeSpec>(spec: T, loopKey: string, bodyKeys: readonly string[]): T {
  return mapStrings(spec, (s) => qualifyBodyRefsIn(s, loopKey, bodyKeys));
}

/** Every string of a stage or an edge, with references through the loop to its body made direct again. */
export function unqualifyBodyRefs<T extends StageSpec | EdgeSpec>(spec: T, loopKey: string, bodyKeys: readonly string[]): T {
  return mapStrings(spec, (s) => unqualifyBodyRefsIn(s, loopKey, bodyKeys));
}
