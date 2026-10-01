import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertSandboxDbPath, assertDummyRepo, rewritePairUrl, mergedFixture } from './sandbox-data.mjs';

test('pair links change only routing hints and preserve consent/security fields', () => {
  const offer = { v: 2, serverId: 'test-server', serverPublicKey: 'test-public-key', pairingGrant: 'test-only-grant',
    requestedScopes: ['read:chats'], pairingExpiresAt: 123, endpoint: 'http://10.0.2.2:3297',
    endpoints: [{ origin: 'http://10.0.2.2:3297', reachability: 'private-network', priority: 0 }], serverName: 'Sandbox' };
  const url = `generatorai://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`;
  for (const platform of ['ios', 'android']) {
    const rewritten = new URL(rewritePairUrl(url, platform, 3297));
    const actual = JSON.parse(Buffer.from(rewritten.searchParams.get('code'), 'base64url'));
    assert.equal(actual.endpoint, `http://${platform === 'ios' ? '127.0.0.1' : '10.0.2.2'}:3297`);
    assert.equal(actual.endpoints[0].origin, actual.endpoint);
    assert.equal(new Set(actual.endpoints.map(item => item.origin)).size, actual.endpoints.length);
    for (const key of Object.keys(offer).filter(key => !['endpoint', 'endpoints'].includes(key))) assert.deepEqual(actual[key], offer[key]);
  }
  assert.throws(() => rewritePairUrl('https://example.invalid/pair?code=x', 'ios'));
  assert.throws(() => rewritePairUrl(url, 'web'));
});

test('sandbox database and dummy repo guards reject checkout paths and symlinks outside their allowed layout', t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-sandbox-guard-'));
  const dummy = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-dummy-repo-guard-'));
  t.after(() => { fs.rmSync(sandbox, { recursive: true, force: true }); fs.rmSync(dummy, { recursive: true, force: true }); });
  const db = path.join(sandbox, 'sandbox.db');fs.writeFileSync(db, 'test');
  const work = path.join(dummy, 'work');fs.mkdirSync(path.join(work, '.git'), { recursive: true });
  assert.equal(assertSandboxDbPath(db), fs.realpathSync(db));
  assert.equal(assertDummyRepo(work), fs.realpathSync(work));
  assert.throws(() => assertSandboxDbPath(import.meta.filename));
  assert.throws(() => assertDummyRepo(process.cwd()));
  assert.throws(() => assertSandboxDbPath(work));
  // Windows junctions do not require developer-mode symlink privileges.
  const link = path.join(sandbox, 'outside');
  fs.symlinkSync(process.cwd(), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertDummyRepo(link));
});

test('mobile fixture merges preserve web scripts and generate the long stream locally', () => {
  const web = { 'Sandbox — Active Chat': [[{ type: 'complete' }]] };
  const mobile = { 'Mobile — Stream': [[{ type: 'text', content: 'hello' }, { type: 'complete' }]] };
  const merged = mergedFixture(web, mobile);
  assert.deepEqual(merged['Sandbox — Active Chat'], web['Sandbox — Active Chat']);
  assert.equal(merged['Mobile — Long stream'][0][0].content.split('\n').length, 2000);
  assert.equal(Object.keys(web).length, 1);
  assert.throws(() => mergedFixture(web, { 'Sandbox — Active Chat': [] }));
});
