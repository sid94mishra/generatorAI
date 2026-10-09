import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertSandboxDbPath, assertDummyRepo, findNewPairing, rewritePairUrl, mergedFixture } from './sandbox-data.mjs';

test('pair links put the https LAN address first and preserve consent/security fields', () => {
  const offer = { v: 2, serverId: 'test-server', serverPublicKey: 'test-public-key', pairingGrant: 'test-only-grant',
    requestedScopes: ['read:chats'], pairingExpiresAt: 123, endpoint: 'https://studio.local:3297',
    certificateFingerprint: 'ca', backupCertificateFingerprint: 'standby',
    endpoints: [
      { origin: 'https://studio.local:3297', reachability: 'lan', priority: 0 },
      { origin: 'https://192.168.0.107:3297', reachability: 'lan', priority: 1 },
      { origin: 'http://127.0.0.1:3297', reachability: 'loopback', priority: 2 },
    ], serverName: 'Sandbox' };
  const url = `generatorai://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`;
  for (const platform of ['ios', 'android']) {
    const rewritten = new URL(rewritePairUrl(url, platform));
    const actual = JSON.parse(Buffer.from(rewritten.searchParams.get('code'), 'base64url'));
    assert.equal(actual.endpoint, 'https://192.168.0.107:3297');
    assert.deepEqual(actual.endpoints.map(item => [item.origin, item.priority]), [
      ['https://192.168.0.107:3297', 0], ['https://studio.local:3297', 1], ['http://127.0.0.1:3297', 2],
    ]);
    for (const key of Object.keys(offer).filter(key => !['endpoint', 'endpoints'].includes(key))) assert.deepEqual(actual[key], offer[key]);
  }
  assert.equal(rewritePairUrl(url, 'ios', { keepOrder: true }), url);
  assert.throws(() => rewritePairUrl('https://example.invalid/pair?code=x', 'ios'));
  assert.throws(() => rewritePairUrl(url, 'web'));
  const plain = { ...offer, endpoint: 'http://10.0.2.2:3297', endpoints: [{ origin: 'http://10.0.2.2:3297', reachability: 'lan', priority: 0 }] };
  assert.throws(() => rewritePairUrl(`generatorai://pair?code=${Buffer.from(JSON.stringify(plain)).toString('base64url')}`, 'android'), /no https/);
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

test('a new pairing is found by id, with the name only as a case-insensitive tie-breaker', () => {
  const started = Date.parse('2026-10-03T10:00:00Z');
  const at = (offset) => new Date(started + offset).toISOString();
  const old = { deviceId: 'old', name: 'gai-iphone', createdAt: at(-3600000) };
  const fresh = { deviceId: 'new', name: 'My iPhone', createdAt: at(2000) };
  const before = new Set(['old']);
  assert.equal(findNewPairing([old, fresh], { before, started, name: 'gai-iphone' }), fresh);
  assert.equal(findNewPairing([old], { before, started, name: 'gai-iphone' }), null);
  assert.equal(findNewPairing([old, { ...fresh, revokedAt: at(3000) }], { before, started, name: 'gai-iphone' }), null);
  // Created before this attempt (beyond the skew allowance) is not this pairing.
  assert.equal(findNewPairing([{ ...fresh, createdAt: at(-120000) }], { before: new Set(), started, name: 'x' }), null);
  // Two candidates: the (auto-capitalised) typed name decides; otherwise ambiguous.
  const other = { deviceId: 'other', name: 'My phone', createdAt: at(1000) };
  const typed = { deviceId: 'typed', name: 'Gai-iphone', createdAt: at(1500) };
  assert.equal(findNewPairing([other, typed], { before, started, name: 'gai-iphone' }), typed);
  assert.equal(findNewPairing([other, fresh], { before, started, name: 'gai-iphone' }), null);
});
