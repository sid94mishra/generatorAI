// ────────────────────────────────────────────────────────────────
// numericEnv — bounded, audited numeric configuration reading.
//
// W18 requires that tuning configuration is "clamped on load, logged, and
// audited". Before this existed, every numeric knob in the server was read
// with a bare `parseInt(process.env[X] ?? '8', 10)`, which has two failure
// modes that both bite silently:
//
//   1. A typo'd value (`GENERATORAI_BROWSER_MAX_CONCURRENT=eight`) parses to
//      `NaN`. `new Semaphore(NaN)` then sets `available = NaN`; `NaN > 0` is
//      false, so `acquire()` awaits a promise nobody resolves and EVERY
//      workflow stage hangs forever with no error and no log.
//   2. An out-of-range value (`=100000`) is accepted verbatim, removing the
//      bound the constant existed to provide.
//
// Both are configuration mistakes that should be loud at boot, not mysterious
// at 3am. `readBoundedInt` parses strictly, clamps into a declared range,
// records what it did, and logs anything other than a clean read. The audit
// registry backs the W18 acceptance criterion that clamping is observable.
// ────────────────────────────────────────────────────────────────

/** What `readBoundedInt` had to do with a given variable. */
export type ConfigReadAction =
  /** Variable unset — the declared default was used. */
  | 'default'
  /** Parsed cleanly and was already in range. */
  | 'ok'
  /** Parsed cleanly but fell outside [min, max] and was clamped. */
  | 'clamped'
  /** Present but not a finite integer — the default was used instead. */
  | 'invalid';

export interface ConfigReadRecord {
  name: string;
  /** The raw environment string, or `undefined` when unset. */
  raw: string | undefined;
  /** The value actually returned to the caller. */
  effective: number;
  action: ConfigReadAction;
  min: number;
  max: number;
}

export interface ReadBoundedIntOptions {
  /** Value used when the variable is unset or unparseable. Must be in range. */
  defaultValue: number;
  /** Inclusive lower bound. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Source of values. Defaults to `process.env`; injectable for tests. */
  env?: Record<string, string | undefined>;
  /** Called for any read that is not a clean in-range parse. */
  onWarn?: (message: string, record: ConfigReadRecord) => void;
}

// Module-level audit trail. Small and append-only: one entry per distinct
// variable per process, overwritten if the same name is read twice (the last
// read is the one that is live).
const auditRegistry = new Map<string, ConfigReadRecord>();

/**
 * Read an integer environment variable, clamped into `[min, max]`.
 *
 * Never returns `NaN`, `Infinity`, or an out-of-range value — an invalid
 * string falls back to `defaultValue` rather than poisoning a downstream
 * `Semaphore` or timer. Every non-clean read is recorded and reported to
 * `onWarn`.
 */
export function readBoundedInt(name: string, opts: ReadBoundedIntOptions): number {
  const { defaultValue, min, max, env = process.env, onWarn } = opts;

  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    throw new RangeError(`readBoundedInt(${name}): invalid range [${min}, ${max}]`);
  }
  if (!Number.isInteger(defaultValue) || defaultValue < min || defaultValue > max) {
    throw new RangeError(
      `readBoundedInt(${name}): defaultValue ${defaultValue} is outside [${min}, ${max}]`,
    );
  }

  const raw = env[name];
  let effective = defaultValue;
  let action: ConfigReadAction = 'default';

  if (raw !== undefined && raw.trim() !== '') {
    // `Number()` rather than `parseInt` on purpose: `parseInt('8abc')` is 8,
    // which quietly accepts a mistyped value. A knob should be exactly a
    // number or a reported error.
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      action = 'invalid';
      effective = defaultValue;
    } else if (parsed < min || parsed > max) {
      action = 'clamped';
      effective = Math.min(max, Math.max(min, parsed));
    } else {
      action = 'ok';
      effective = parsed;
    }
  }

  const record: ConfigReadRecord = { name, raw, effective, action, min, max };
  auditRegistry.set(name, record);

  if (action === 'invalid') {
    onWarn?.(
      `[config] ${name}="${raw}" is not an integer — using default ${defaultValue}.`,
      record,
    );
  } else if (action === 'clamped') {
    onWarn?.(
      `[config] ${name}=${raw} is outside [${min}, ${max}] — clamped to ${effective}.`,
      record,
    );
  }

  return effective;
}

/** Every variable read so far this process, for `/api/health` and tests. */
export function getConfigAudit(): ConfigReadRecord[] {
  return [...auditRegistry.values()];
}

/** Only the reads that needed correcting — the interesting subset for ops. */
export function getConfigCorrections(): ConfigReadRecord[] {
  return getConfigAudit().filter((r) => r.action === 'invalid' || r.action === 'clamped');
}

/** Test-only: drop the audit trail so cases do not leak into each other. */
export function resetConfigAudit(): void {
  auditRegistry.clear();
}
