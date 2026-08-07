// Re-keying is recovery code: it only ever runs when the vault would otherwise
// be unreadable, so a bug here is discovered at the worst possible moment.
// These tests pin both halves of the contract — that a legitimate key change
// migrates every entry, and that a wrong key changes nothing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EncryptedFileSecretStore } from '../EncryptedFileSecretStore.js';
import { EnvKeyProvider } from '../KeyProvider.js';

let dir: string;
let vaultPath: string;

const KEY_A = Buffer.alloc(32, 1).toString('base64');
const KEY_B = Buffer.alloc(32, 2).toString('base64');
const KEY_C = Buffer.alloc(32, 3).toString('base64');

function store(): EncryptedFileSecretStore {
  return new EncryptedFileSecretStore({
    vaultPath,
    keyProvider: new EnvKeyProvider(path.join(dir, 'salt')),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-rekey-'));
  vaultPath = path.join(dir, 'secrets.vault.json');
  delete process.env['GENERATORAI_SECRET_KEY_PREVIOUS'];
  process.env['GENERATORAI_SECRET_KEY'] = KEY_A;
});

afterEach(() => {
  delete process.env['GENERATORAI_SECRET_KEY'];
  delete process.env['GENERATORAI_SECRET_KEY_PREVIOUS'];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('vault re-keying', () => {
  it('does nothing when the key has not changed', async () => {
    await store().set('system', 'token-signing-seed', new Uint8Array([1, 2, 3]));
    expect(await store().migrateKeyIfNeeded()).toBe('not-needed');
    expect(await store().get('system', 'token-signing-seed')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('does nothing on an empty vault', async () => {
    expect(await store().migrateKeyIfNeeded()).toBe('not-needed');
  });

  it('re-encrypts every entry when the operator changes the key', async () => {
    const original = store();
    await original.set('system', 'host-identity-x25519', new Uint8Array([9, 9, 9]));
    await original.set('system', 'token-signing-seed', new Uint8Array([4, 5]));
    await original.set('integrations', 'github-token', new Uint8Array([7]));

    // The operator rotates: new key current, old key offered for migration.
    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = KEY_A;

    expect(await store().migrateKeyIfNeeded()).toBe('migrated');

    // Readable under the NEW key alone — the old one is no longer required.
    delete process.env['GENERATORAI_SECRET_KEY_PREVIOUS'];
    const migrated = store();
    expect(await migrated.get('system', 'host-identity-x25519')).toEqual(new Uint8Array([9, 9, 9]));
    expect(await migrated.get('system', 'token-signing-seed')).toEqual(new Uint8Array([4, 5]));
    expect(await migrated.get('integrations', 'github-token')).toEqual(new Uint8Array([7]));
  });

  it('bumps the kek version so old ciphertext cannot be replayed into the new vault', async () => {
    await store().set('system', 'seed', new Uint8Array([1]));
    const before = JSON.parse(fs.readFileSync(vaultPath, 'utf8')) as { kekVersion: number };

    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = KEY_A;
    await store().migrateKeyIfNeeded();

    const after = JSON.parse(fs.readFileSync(vaultPath, 'utf8')) as { kekVersion: number };
    expect(after.kekVersion).toBe(before.kekVersion + 1);
  });

  it('finds the right key among several candidates', async () => {
    await store().set('system', 'seed', new Uint8Array([42]));

    process.env['GENERATORAI_SECRET_KEY'] = KEY_C;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = `${KEY_B}, ${KEY_A}`;

    expect(await store().migrateKeyIfNeeded()).toBe('migrated');
    delete process.env['GENERATORAI_SECRET_KEY_PREVIOUS'];
    expect(await store().get('system', 'seed')).toEqual(new Uint8Array([42]));
  });

  it('ignores malformed candidates instead of abandoning the recovery', async () => {
    await store().set('system', 'seed', new Uint8Array([42]));

    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = `not-base64!!, , ${KEY_A}`;

    expect(await store().migrateKeyIfNeeded()).toBe('migrated');
  });

  it('leaves the vault untouched when no candidate key fits', async () => {
    await store().set('system', 'seed', new Uint8Array([1]));
    const before = fs.readFileSync(vaultPath, 'utf8');

    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = KEY_C;

    expect(await store().migrateKeyIfNeeded()).toBe('not-needed');
    // A wrong key must not be able to damage a vault that is still perfectly
    // recoverable with the correct one.
    expect(fs.readFileSync(vaultPath, 'utf8')).toBe(before);

    process.env['GENERATORAI_SECRET_KEY'] = KEY_A;
    expect(await store().get('system', 'seed')).toEqual(new Uint8Array([1]));
  });

  it('refuses a partial migration when only some entries decrypt', async () => {
    await store().set('system', 'good', new Uint8Array([1]));

    // Splice in an entry that no key can open, imitating a corrupt record.
    const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8')) as {
      entries: Record<string, { iv: string; ct: string; tag: string; v: number; kv: number }>;
    };
    const template = vault.entries['system/good']!;
    vault.entries['system/corrupt'] = {
      ...template,
      ct: crypto.randomBytes(16).toString('base64'),
    };
    fs.writeFileSync(vaultPath, JSON.stringify(vault));

    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    process.env['GENERATORAI_SECRET_KEY_PREVIOUS'] = KEY_A;

    // All-or-nothing: re-keying only the readable half would strand the rest
    // under a key the operator is about to delete.
    expect(await store().migrateKeyIfNeeded()).toBe('not-needed');
  });

  it('survives a re-key with no previous key configured', async () => {
    await store().set('system', 'seed', new Uint8Array([1]));
    process.env['GENERATORAI_SECRET_KEY'] = KEY_B;
    expect(await store().migrateKeyIfNeeded()).toBe('not-needed');
  });
});
