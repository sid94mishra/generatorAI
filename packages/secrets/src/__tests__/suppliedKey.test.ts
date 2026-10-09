// F-8 (D-128) — the desktop app hands the vault key to the server in memory
// (its process channel) instead of GENERATORAI_SECRET_KEY in the environment.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSecretStore } from '../createSecretStore.js';

let dir: string;
const saved = { key: process.env['GENERATORAI_SECRET_KEY'], pass: process.env['GENERATORAI_SECRET_PASSPHRASE'] };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-supplied-key-'));
  delete process.env['GENERATORAI_SECRET_KEY'];
  delete process.env['GENERATORAI_SECRET_PASSPHRASE'];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (saved.key === undefined) delete process.env['GENERATORAI_SECRET_KEY'];
  else process.env['GENERATORAI_SECRET_KEY'] = saved.key;
  if (saved.pass === undefined) delete process.env['GENERATORAI_SECRET_PASSPHRASE'];
  else process.env['GENERATORAI_SECRET_PASSPHRASE'] = saved.pass;
});

describe('createSecretStore({ suppliedKey })', () => {
  it('uses the handed-over key with no environment variable set, and reads back what it wrote', async () => {
    const key = crypto.randomBytes(32).toString('base64');
    const store = createSecretStore({ dataDir: dir, suppliedKey: key, requireSecure: true });
    expect(await store.backendInfo()).toMatchObject({ kind: 'encrypted-file/env-key', secure: true });
    await store.set('system', 'probe', Buffer.from('value'));
    const again = createSecretStore({ dataDir: dir, suppliedKey: key, requireSecure: true });
    expect(Buffer.from((await again.get('system', 'probe'))!).toString()).toBe('value');
    expect(process.env['GENERATORAI_SECRET_KEY']).toBeUndefined();
  });

  it('without a supplied key or env key it is not a secure backend (requireSecure refuses)', () => {
    expect(() => createSecretStore({ dataDir: dir, requireSecure: true })).toThrow(/insecure secret backend/i);
  });
});
