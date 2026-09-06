// Shared utilities

export * from './pairingCode.js';

// Composer caret insertion — shared by the web and mobile dictation
// composers (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C.2). Pure
// data-in/data-out, no DOM and no React, which is exactly why it can live
// here and be used from React Native as-is.
export { insertTextAtCaret, CaretInsertionSequencer } from './insertAtCaret.js';
export type { CaretInsertResult } from './insertAtCaret.js';

// Dictation stitching — spacing, sentence case and "scratch that" between
// one utterance and the next. Same reasoning: pure, DOM-free, used by the
// server-side formatter and by both composers.
export {
  SCRATCH_THAT,
  applyScratchCommand,
  splitScratchCommand,
  stripLocaleTags,
  dictationSeparator,
  continueCase,
  stitchDictation,
} from './dictationText.js';
export type { StitchResult } from './dictationText.js';

export {
  evaluateBlocklist,
  buildBlocklist,
  normaliseAppText,
  executableBasename,
  DEFAULT_COMPUTER_USE_BLOCKLIST,
} from './computerUseBlocklist.js';
export type {
  ComputerUseBlocklist,
  BlocklistCandidate,
  BlocklistVerdict,
  BlocklistOptions,
} from './computerUseBlocklist.js';

/**
 * Generate a unique ID using the Web Crypto `randomUUID`, available on
 * `globalThis.crypto` in Node.js 19+ and all modern browsers. This package
 * targets Node >=20, so it is always present — no CommonJS `require` fallback
 * (which would throw `require is not defined` in this ESM package).
 */
export function generateId(): string {
  return globalThis.crypto.randomUUID();
}

/** Deep merge two objects. Source values override target. */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  return deepMergeInternal(target, source, new WeakSet()) as T;
}

/**
 * Phase 2, 2.19 — cycle-aware inner implementation. A caller passing a
 * self-referential source (e.g. `obj.self = obj`) used to spin into a stack
 * overflow; the WeakSet tracks source objects already in the recursion chain
 * and copies the reference verbatim on re-entry.
 */
function deepMergeInternal(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (seen.has(source)) return { ...target, ...source };
  seen.add(source);
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      typeof sourceVal === 'object' &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      !(sourceVal instanceof Date) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal) &&
      !(targetVal instanceof Date)
    ) {
      result[key] = deepMergeInternal(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
        seen,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

/** Sleep for the given number of milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { parseBatchData, resolveIterationVariables, buildIterationLabel } from './batchDataParser.js';
export {
  matchesHostPattern,
  matchesAnyHostPattern,
  isLoopbackHost,
  isLinkLocalHost,
  isDefaultBlockedHost,
  isNavigationAllowed,
} from './hostMatcher.js';
export type { NavigationVerdict } from './hostMatcher.js';
export {
  validateCronExpression,
  isValidTimezone,
  getNextCronRun,
  countCronRunsBetween,
} from './cron.js';
export type { ParsedCron, CronValidation } from './cron.js';
export {
  SECRET_MASK,
  makeSecretRef,
  isSecretRef,
  parseSecretRefValue,
  isSensitiveKey,
} from './secretRefs.js';

// ── Variable Interpolation ──

/**
 * Standard regex for `{{variableName}}` placeholders. Matches word chars, dots,
 * and hyphens. Optional surrounding whitespace is tolerated so `{{ topic }}`
 * resolves identically to `{{topic}}` (the key is trimmed before lookup).
 */
const VARIABLE_PATTERN = /\{\{\s*([\w.\-]+)\s*\}\}/g;

/** Max depth for dotted-path traversal inside `{{...}}` placeholders. */
const MAX_PATH_DEPTH = 16;

/**
 * Resolve a dotted-path key like `"user.profile.name"` against a vars bag.
 * Returns the raw value or `undefined` if any segment misses. Bails out past
 * `MAX_PATH_DEPTH` segments to block pathological deeply-nested lookups.
 */
function resolveDottedPath(key: string, vars: Record<string, unknown>): unknown {
  // Exact-key match takes precedence so callers can pass `{ "a.b": 1 }` and
  // have it win over nested `{ a: { b: 2 } }` — existing behavior preserved.
  if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
  const parts = key.split('.');
  if (parts.length > MAX_PATH_DEPTH) return undefined;
  let current: unknown = vars;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Interpolate `{{variableName}}` placeholders in a template string.
 * Supports dotted paths (`{{user.name}}`) with flat-key priority.
 * Returns unresolved placeholders as-is and collects their names in the optional `unresolved` set.
 * Single-pass — interpolated values are NOT re-scanned, preventing recursion.
 */
export function interpolateVariables(
  template: string,
  vars: Record<string, unknown>,
  unresolved?: Set<string>,
): string {
  return template.replace(VARIABLE_PATTERN, (_, rawKey: string) => {
    const key = rawKey.trim();
    const value = resolveDottedPath(key, vars);
    if (value === undefined || value === null) {
      unresolved?.add(key);
      return `{{${key}}}`;
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}
