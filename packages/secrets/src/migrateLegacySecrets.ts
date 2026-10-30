// ────────────────────────────────────────────────────────────────
// migrateLegacySecrets — moves plaintext credentials out of JSON config
// files and into the SecretStore, replacing them with a secret reference.
//
// Rules from the plan (§10.4):
//   1. Never read a legacy secret before the secure backend is validated.
//   2. Verify a read-after-write round trip before deleting the plaintext.
//   3. Rewrite the source file atomically.
//   4. Never log the old value.
//   5. Secure deletion cannot be guaranteed on journaled/CoW filesystems —
//      the caller is told to rotate high-value credentials afterwards.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomicRestricted } from '@generatorai/shared/node';
import { SecretStoreError, secretRefToString, type SecretRef, type SecretStore } from './SecretStore.js';

/** One plaintext credential living at `jsonPath` inside `file`. */
export interface LegacySecretSource {
  /** Absolute path to the JSON config file. */
  file: string;
  /** Dotted path to the string field, e.g. `github.token` or `server.apiKey`. */
  jsonPath: string;
  /** Where the value should be stored. */
  target: SecretRef;
  /** Human label for the migration report. */
  label: string;
}

export interface MigrationOutcome {
  label: string;
  file: string;
  jsonPath: string;
  ref: string;
  status: 'migrated' | 'absent' | 'already-migrated' | 'failed';
  error?: string;
}

/** Marker written in place of the plaintext value. */
export const SECRET_REF_PREFIX = 'secretref:';

export function isSecretReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

export function secretReferenceValue(ref: SecretRef): string {
  return `${SECRET_REF_PREFIX}${secretRefToString(ref)}`;
}

/** Default locations GeneratorAI historically wrote plaintext credentials to. */
export function defaultLegacySecretSources(opts: {
  homeDir: string;
  /** Server data dir where `source-control.json` lives. */
  configDir?: string | undefined;
  /** Electron `userData` dir, when running in the desktop shell. */
  desktopUserDataDir?: string | undefined;
  cwd?: string | undefined;
}): LegacySecretSource[] {
  const sources: LegacySecretSource[] = [
    {
      label: 'CLI server API key (user config)',
      file: path.join(opts.homeDir, '.generatorai', 'config.json'),
      jsonPath: 'server.apiKey',
      target: { namespace: 'integration/generatorai/cli', name: 'api-key' },
    },
  ];
  if (opts.cwd) {
    sources.push({
      label: 'CLI server API key (project config)',
      file: path.join(opts.cwd, '.generatorai', 'config.json'),
      jsonPath: 'server.apiKey',
      target: { namespace: 'integration/generatorai/cli-project', name: 'api-key' },
    });
  }
  if (opts.configDir) {
    sources.push({
      label: 'GitHub source-control token',
      file: path.join(opts.configDir, 'source-control.json'),
      jsonPath: 'github.token',
      target: { namespace: 'integration/github/default', name: 'token' },
    });
  }
  if (opts.desktopUserDataDir) {
    sources.push({
      label: 'Desktop stored API key',
      file: path.join(opts.desktopUserDataDir, 'settings.json'),
      jsonPath: 'apiKey',
      target: { namespace: 'integration/generatorai/desktop', name: 'api-key' },
    });
  }
  return sources;
}

export async function migrateLegacySecrets(params: {
  store: SecretStore;
  sources: LegacySecretSource[];
  logger?: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void };
  /** When false, secrets are copied into the vault but plaintext is left alone. */
  removePlaintext?: boolean;
}): Promise<MigrationOutcome[]> {
  const { store, sources, logger } = params;
  const removePlaintext = params.removePlaintext !== false;

  // Rule 1 — never read plaintext credentials into memory if we cannot store
  // them somewhere better than where they already are.
  const backend = await store.backendInfo();
  if (!backend.secure) {
    logger?.warn(
      `[Secrets] Skipping legacy credential migration — backend "${backend.kind}" is not ` +
        'OS-protected, so migrating would not improve confidentiality.',
    );
    return sources.map((s) => ({
      label: s.label,
      file: s.file,
      jsonPath: s.jsonPath,
      ref: secretRefToString(s.target),
      status: 'failed' as const,
      error: 'insecure-backend',
    }));
  }

  const outcomes: MigrationOutcome[] = [];
  for (const source of sources) {
    const base: Omit<MigrationOutcome, 'status'> = {
      label: source.label,
      file: source.file,
      jsonPath: source.jsonPath,
      ref: secretRefToString(source.target),
    };
    try {
      if (!fs.existsSync(source.file)) {
        outcomes.push({ ...base, status: 'absent' });
        continue;
      }
      const raw = fs.readFileSync(source.file, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = readJsonPath(parsed, source.jsonPath);

      if (isSecretReference(value)) {
        outcomes.push({ ...base, status: 'already-migrated' });
        continue;
      }
      if (typeof value !== 'string' || value.length === 0) {
        outcomes.push({ ...base, status: 'absent' });
        continue;
      }

      await store.set(source.target.namespace, source.target.name, new TextEncoder().encode(value));

      // Rule 2 — verify the round trip before destroying the only copy.
      const readBack = await store.get(source.target.namespace, source.target.name);
      if (!readBack || new TextDecoder().decode(readBack) !== value) {
        throw new SecretStoreError('Read-after-write verification failed', 'INTEGRITY');
      }

      if (removePlaintext) {
        writeJsonPath(parsed, source.jsonPath, secretReferenceValue(source.target));
        writeFileAtomicRestricted(source.file, JSON.stringify(parsed, null, 2));
      }

      // Rule 4 — the value never appears in the log line.
      logger?.info(`[Secrets] Migrated ${source.label} → ${base.ref}`);
      outcomes.push({ ...base, status: 'migrated' });
    } catch (err) {
      outcomes.push({
        ...base,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      logger?.warn(`[Secrets] Failed to migrate ${source.label}`, {
        file: source.file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (outcomes.some((o) => o.status === 'migrated')) {
    logger?.warn(
      '[Secrets] Plaintext credentials were removed from disk, but secure deletion cannot be ' +
        'guaranteed on journaled or copy-on-write filesystems. Rotate high-value tokens.',
    );
  }
  return outcomes;
}

function readJsonPath(root: Record<string, unknown>, jsonPath: string): unknown {
  let cursor: unknown = root;
  for (const segment of jsonPath.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function writeJsonPath(root: Record<string, unknown>, jsonPath: string, value: string): void {
  const segments = jsonPath.split('.');
  const last = segments.pop();
  /* c8 ignore next */
  if (!last) return;
  let cursor: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[last] = value;
}

/**
 * Resolves a config value that may be either a literal secret (legacy) or a
 * `secretref:` pointer. Used by services during the compatibility window.
 */
export async function resolveMaybeSecretRef(
  store: SecretStore,
  value: string | undefined | null,
): Promise<string | undefined> {
  if (!value) return undefined;
  if (!isSecretReference(value)) return value;
  const refString = value.slice(SECRET_REF_PREFIX.length);
  const idx = refString.lastIndexOf('/');
  if (idx <= 0) return undefined;
  const bytes = await store.get(refString.slice(0, idx), refString.slice(idx + 1));
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}
