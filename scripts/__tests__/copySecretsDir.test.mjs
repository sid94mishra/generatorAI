// Pins the half of `pnpm db:backup` that §5.11 found missing: the secrets
// directory travels with the database. Runs under the root vitest "node"
// project (`pnpm test:scripts`; `turbo test` runs it).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { copySecretsDir, defaultSecretsDirFor } from '../lib/copySecretsDir.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-backup-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('defaultSecretsDirFor', () => {
  it('is <dbDir>/secrets when GENERATORAI_SECRETS_DIR is unset', () => {
    expect(defaultSecretsDirFor(path.join(dir, 'data.db'), {})).toBe(path.join(dir, 'secrets'));
  });

  it('honours GENERATORAI_SECRETS_DIR the same way the server does (<dir>/secrets)', () => {
    const custom = path.join(dir, 'elsewhere');
    expect(defaultSecretsDirFor(path.join(dir, 'data.db'), { GENERATORAI_SECRETS_DIR: custom })).toBe(
      path.join(custom, 'secrets'),
    );
  });
});

describe('copySecretsDir', () => {
  it('copies every file, nested directories included, byte for byte', () => {
    const src = path.join(dir, 'secrets');
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(src, 'kek.key'), Buffer.alloc(32, 1));
    fs.writeFileSync(path.join(src, 'secrets.vault.json'), '{"v":1}');
    fs.writeFileSync(path.join(src, 'nested', 'salt'), Buffer.alloc(16, 2));

    const dest = path.join(dir, 'backup.secrets');
    const result = copySecretsDir(src, dest);

    expect(result.files).toBe(3);
    expect(result.bytes).toBe(32 + 7 + 16);
    expect(fs.readFileSync(path.join(dest, 'kek.key')).equals(Buffer.alloc(32, 1))).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'secrets.vault.json'), 'utf8')).toBe('{"v":1}');
    expect(fs.readFileSync(path.join(dest, 'nested', 'salt')).equals(Buffer.alloc(16, 2))).toBe(true);
  });

  it('restricts copied key material to the owner where the platform enforces modes', () => {
    const src = path.join(dir, 'secrets');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'kek.key'), Buffer.alloc(32, 1), { mode: 0o644 });
    const dest = path.join(dir, 'backup.secrets');
    copySecretsDir(src, dest);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dest, 'kek.key')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(dest).mode & 0o777).toBe(0o700);
    }
  });

  it('throws when the source directory is missing so the caller can warn loudly', () => {
    expect(() => copySecretsDir(path.join(dir, 'nope'), path.join(dir, 'out'))).toThrow(/not found/);
  });
});
