// ────────────────────────────────────────────────────────────────
// Config migration and salvage (open question #37).
//
// `CONFIG_VERSION` is 2, so a version 1 exists in the wild — but there was
// no migration anywhere. `readUserConfig` did this:
//
//     const parsed = CliConfigSchema.safeParse(data);
//     return parsed.success ? parsed.data : CliConfigSchema.parse({});
//
// which means a config the schema cannot parse is SILENTLY replaced by
// defaults. That alone is bad; what makes it data loss is the next step —
// `config set` reads through that function and then WRITES the result, so a
// single unrecognised key turns into "every setting you ever changed is
// gone", with no message.
//
// The fix is salvage, not reset. A config file is almost never wholly
// invalid: one key has the wrong type, or one section is from an older
// layout. Parsing SECTION BY SECTION keeps everything that is still valid,
// names what it could not keep, and leaves the rest at its default — so a
// bad `tui.accent` costs the user their accent colour, not their server URL,
// their connections and their profiles.
//
// Pure, so the whole thing is testable without touching a filesystem.
// ────────────────────────────────────────────────────────────────

import { CliConfigSchema, CONFIG_VERSION, type CliConfig } from './schema.js';

export interface ConfigMigration {
  config: CliConfig;
  /** The version the file declared, when it declared one. */
  fromVersion: number | null;
  /** True when anything had to be salvaged or upgraded. */
  changed: boolean;
  /**
   * Dotted paths that could not be kept, each with the reason.
   *
   * Reported rather than logged-and-forgotten: a user who loses a setting
   * should be told which one, and a support conversation needs the reason.
   */
  dropped: Array<{ path: string; reason: string }>;
}

/** The top-level sections that are parsed independently during salvage. */
const SECTIONS = [
  'server',
  'cli',
  'tui',
  'keymap',
  'connections',
  'profiles',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Brings a raw parsed config file up to the current shape.
 *
 * Never throws and never returns a config the schema would reject: the
 * worst case is defaults plus a full list of what was dropped, which is the
 * old behaviour PLUS the explanation it never gave.
 */
export function migrateConfig(raw: unknown): ConfigMigration {
  const dropped: ConfigMigration['dropped'] = [];

  if (!isPlainObject(raw)) {
    return {
      config: CliConfigSchema.parse({}),
      fromVersion: null,
      // A missing/empty file is the normal first-run case, not a migration.
      changed: false,
      dropped: raw === undefined || raw === null ? [] : [{ path: '(root)', reason: 'not an object' }],
    };
  }

  const declared = typeof raw['configVersion'] === 'number' ? raw['configVersion'] : null;

  // The happy path: already current and valid. Checked first so a healthy
  // config costs one parse, not seven.
  const whole = CliConfigSchema.safeParse(raw);
  if (whole.success && declared === CONFIG_VERSION) {
    return { config: whole.data, fromVersion: declared, changed: false, dropped: [] };
  }

  // Salvage. Each section is parsed on its own against a config that is
  // otherwise defaults, so one bad section cannot take the others with it.
  const candidate: Record<string, unknown> = { configVersion: CONFIG_VERSION };
  for (const section of SECTIONS) {
    if (!(section in raw)) continue;
    const attempt = CliConfigSchema.safeParse({ ...candidate, [section]: raw[section] });
    if (attempt.success) {
      candidate[section] = raw[section];
      // Zod's objects STRIP unknown keys rather than rejecting them, so a
      // setting removed in a newer version parses "successfully" and then
      // silently disappears. During a version upgrade that is exactly what
      // the user most wants told: their `cli.legacyPagination` is not being
      // honoured any more.
      //
      // `keymap` is exempt: it is `z.record(z.string())`, so every key in it
      // is legitimately user-defined and none is ever unknown.
      if (section !== 'keymap' && section !== 'profiles' && isPlainObject(raw[section])) {
        const parsedSection = (attempt.data as unknown as Record<string, unknown>)[section];
        if (isPlainObject(parsedSection)) {
          for (const key of Object.keys(raw[section])) {
            if (!(key in parsedSection)) {
              dropped.push({ path: `${section}.${key}`, reason: 'no longer a setting' });
            }
          }
        }
      }
      continue;
    }
    // A whole section rejected: try to keep the individual KEYS inside it,
    // so one bad value does not cost the rest of the section either.
    if (isPlainObject(raw[section])) {
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw[section])) {
        const keyAttempt = CliConfigSchema.safeParse({
          ...candidate,
          [section]: { ...kept, [key]: value },
        });
        if (keyAttempt.success) kept[key] = value;
        else {
          dropped.push({
            path: `${section}.${key}`,
            reason: firstIssue(keyAttempt.error, `${section}.${key}`),
          });
        }
      }
      if (Object.keys(kept).length > 0) candidate[section] = kept;
    } else {
      dropped.push({ path: section, reason: firstIssue(attempt.error, section) });
    }
  }

  // `activeConnection` / `activeProfile` are scalars, not sections.
  for (const key of ['activeConnection', 'activeProfile'] as const) {
    if (!(key in raw)) continue;
    const attempt = CliConfigSchema.safeParse({ ...candidate, [key]: raw[key] });
    if (attempt.success) candidate[key] = raw[key];
    else dropped.push({ path: key, reason: firstIssue(attempt.error, key) });
  }

  const parsed = CliConfigSchema.safeParse(candidate);
  return {
    // `candidate` is built only from values that already parsed, so this
    // cannot realistically fail — the fallback exists so a future schema
    // change cannot turn a migration into a crash on startup.
    config: parsed.success ? parsed.data : CliConfigSchema.parse({}),
    fromVersion: declared,
    changed: true,
    dropped,
  };
}

/** A one-line, user-facing summary, or `null` when nothing needs saying. */
export function describeMigration(migration: ConfigMigration): string | null {
  if (!migration.changed) return null;
  const version =
    migration.fromVersion === null
      ? 'an unversioned config'
      : `config version ${migration.fromVersion}`;
  if (migration.dropped.length === 0) {
    return `Upgraded ${version} to version ${CONFIG_VERSION}.`;
  }
  return (
    `Upgraded ${version} to version ${CONFIG_VERSION}, dropping ` +
    `${migration.dropped.length} setting(s) it could not read: ` +
    migration.dropped.map((entry) => entry.path).join(', ')
  );
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }, path: string): string {
  const issue = error.issues.find((i) => i.path.join('.') === path) ?? error.issues[0];
  return issue?.message ?? 'invalid value';
}
