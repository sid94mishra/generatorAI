// ────────────────────────────────────────────────────────────────
// Turning what a human typed into an id the server understands.
//
// Every id in this system is a UUID. Nobody types a UUID twice, so the CLI
// accepts short forms and resolves them against a list:
//
//   a3f2                 unique id prefix
//   #3                   positional, from the last list this shell printed
//   @last                most recently created / updated
//   @active              the one currently running, when unambiguous
//   "nightly e2e"        exact or unique case-insensitive name match
//
// Ambiguity is an error with the candidates listed, never a silent pick of
// the first match — resuming the wrong run because two ids share four
// characters is not a recoverable mistake.
// ────────────────────────────────────────────────────────────────

import { CliError } from '../errors/CliError.js';

/**
 * The minimum a value needs to be referenceable.
 *
 * Deliberately loose on the optional fields: entities arrive from a dozen
 * routes with `name` typed as `string`, `string | null` or absent, and
 * timestamps as ISO strings, epoch numbers or `Date`. Narrowing here would
 * force a cast at every call site, and a cast is exactly where a wrong field
 * name stops being a compile error.
 */
export interface Referenceable {
  id: string;
  name?: string | null | undefined;
  status?: string | null | undefined;
  createdAt?: string | number | Date | null | undefined;
  updatedAt?: string | number | Date | null | undefined;
}

export interface ResolveOptions<T extends Referenceable> {
  /** What the thing is called in errors, e.g. `run`. */
  kind: string;
  candidates: T[];
  /** Statuses that `@active` should match, most-preferred first. */
  activeStatuses?: string[];
  /** Positional history for `#n`, most recent listing first. */
  recent?: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeId(ref: string): boolean {
  return UUID_RE.test(ref);
}

function epoch(value: string | number | Date | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ambiguous<T extends Referenceable>(kind: string, ref: string, matches: T[]): never {
  throw new CliError('AMBIGUOUS_REF', `"${ref}" matches ${matches.length} ${kind}s.`, {
    hint: 'Use more characters of the id, or the full id.',
    suggestions: matches
      .slice(0, 8)
      .map((m) => `${m.id}${m.name ? `  ${m.name}` : ''}`),
    details: { matches: matches.map((m) => m.id) },
  });
}

/**
 * Resolves one reference against a candidate list.
 *
 * Deliberately synchronous and list-based rather than issuing its own lookup:
 * the caller already had to fetch the list to render it, and a second network
 * round-trip per argument would double the latency of every command.
 */
export function resolveRef<T extends Referenceable>(ref: string, options: ResolveOptions<T>): T {
  const { kind, candidates } = options;
  const trimmed = ref.trim();

  if (!trimmed) {
    throw CliError.usage(`A ${kind} reference is required.`);
  }

  if (candidates.length === 0) {
    throw CliError.notFound(kind, trimmed, {
      hint: `No ${kind}s exist yet.`,
    });
  }

  // Exact id — the common case once a script has one.
  const exact = candidates.find((c) => c.id === trimmed);
  if (exact) return exact;

  // #n — positional against the most recent listing.
  if (/^#\d+$/.test(trimmed)) {
    const index = Number(trimmed.slice(1)) - 1;
    const fromHistory = options.recent?.[index];
    const target = fromHistory
      ? candidates.find((c) => c.id === fromHistory)
      : candidates[index];
    if (!target) {
      throw CliError.notFound(kind, trimmed, {
        hint: `Only ${candidates.length} ${kind}s are available.`,
      });
    }
    return target;
  }

  if (trimmed === '@last') {
    const sorted = [...candidates].sort(
      (a, b) =>
        Math.max(epoch(b.updatedAt), epoch(b.createdAt)) -
        Math.max(epoch(a.updatedAt), epoch(a.createdAt)),
    );
    const target = sorted[0];
    if (!target) throw CliError.notFound(kind, trimmed);
    return target;
  }

  if (trimmed === '@active') {
    const statuses = options.activeStatuses ?? ['running', 'awaiting_input', 'paused', 'starting'];
    for (const status of statuses) {
      const matches = candidates.filter((c) => c.status === status);
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) ambiguous(kind, trimmed, matches);
    }
    throw CliError.notFound(kind, trimmed, {
      hint: `No ${kind} is currently ${statuses.join(' or ')}.`,
    });
  }

  // Exact name.
  const byName = candidates.filter((c) => c.name === trimmed);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) ambiguous(kind, trimmed, byName);

  // Case-insensitive name.
  const lowered = trimmed.toLowerCase();
  const byNameCI = candidates.filter((c) => c.name?.toLowerCase() === lowered);
  if (byNameCI.length === 1) return byNameCI[0]!;
  if (byNameCI.length > 1) ambiguous(kind, trimmed, byNameCI);

  // Id prefix. Requires 4+ characters: shorter prefixes collide constantly
  // across a few hundred UUIDs and would turn "resolve" into "guess".
  if (trimmed.length >= 4) {
    const byPrefix = candidates.filter((c) => c.id.startsWith(lowered));
    if (byPrefix.length === 1) return byPrefix[0]!;
    if (byPrefix.length > 1) ambiguous(kind, trimmed, byPrefix);
  }

  // Name substring — last resort, so `run cancel nightly` works.
  const bySubstring = candidates.filter((c) => c.name?.toLowerCase().includes(lowered));
  if (bySubstring.length === 1) return bySubstring[0]!;
  if (bySubstring.length > 1) ambiguous(kind, trimmed, bySubstring);

  throw CliError.notFound(kind, trimmed, {
    hint:
      trimmed.length < 4 && /^[0-9a-f]+$/i.test(trimmed)
        ? 'Id prefixes need at least 4 characters.'
        : undefined,
    suggestions: candidates
      .slice(0, 5)
      .map((c) => `${c.id.slice(0, 8)}  ${c.name ?? ''}`.trim()),
  });
}

/** Resolves to an id, for callers that only need the identifier. */
export function resolveRefId<T extends Referenceable>(ref: string, options: ResolveOptions<T>): string {
  return resolveRef(ref, options).id;
}

/** Resolves many refs, reporting every failure at once rather than the first. */
export function resolveRefs<T extends Referenceable>(
  refs: string[],
  options: ResolveOptions<T>,
): T[] {
  const resolved: T[] = [];
  const failures: string[] = [];
  for (const ref of refs) {
    try {
      resolved.push(resolveRef(ref, options));
    } catch (error) {
      failures.push(`${ref}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) {
    throw new CliError('NOT_FOUND', `Could not resolve ${failures.length} ${options.kind} reference(s).`, {
      suggestions: failures,
    });
  }
  return resolved;
}
