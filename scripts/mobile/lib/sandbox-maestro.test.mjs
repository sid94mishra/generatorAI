import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { flowMetadata, discoverFlows, combineJunitReports, withFlowScopes } from './sandbox-maestro.mjs';

test('reads Maestro flow headers and excludes shared command fragments', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generatorai-mobile-flow-test-'));
  try {
    const file = path.join(dir, 'flow.yaml');
    await fs.writeFile(file, 'appId: ${APP_ID}\ntags: [smoke, pairing]\nenv:\n  FRESH_CHAT: gate,stream\n  PENDING_GATE: true\n---\n- launchApp\n');
    assert.deepEqual(await flowMetadata(file), { fresh: ['gate', 'stream'], scopes: [], pending: 'gate', tags: ['smoke', 'pairing'], name: 'flow' });
    await fs.writeFile(file, '- tapOn: Continue\n');
    assert.equal(await flowMetadata(file), null);
    await fs.writeFile(file, 'appId: ${APP_ID}\nenv: {FRESH_CHAT: invented}\n---\n- launchApp\n');
    await assert.rejects(flowMetadata(file), /Unknown FRESH_CHAT/);
    await fs.writeFile(file, 'appId: app\nenv: {DEVICE_SCOPES: "admin:devices"}\n---\n- launchApp\n');
    await assert.rejects(flowMetadata(file), /Unsupported characterization scope/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('scenario scopes are restored after a failed native run, on the paired device only', async () => {
  const calls = [];
  const session = {
    state: { paired: [{ serial: 'emulator-test', deviceId: 'paired-device' }] },
    api: async (route, body, method) => {
      calls.push({ route, body, method });
      if (!body) return { devices: [{ deviceId: 'other', scopes: ['admin:settings'] }, { deviceId: 'paired-device', scopes: ['read:chats'] }] };
    },
  };
  await assert.rejects(withFlowScopes(session, { platform: 'android', serial: 'emulator-test' }, ['exec:terminal'], async () => { throw new Error('Native failure'); }), /Native failure/);
  assert.deepEqual(calls.slice(1), [
    { route: '/auth/devices/paired-device/scopes', body: { scopes: ['read:chats', 'exec:terminal'] }, method: 'PUT' },
    { route: '/auth/devices/paired-device/scopes', body: { scopes: ['read:chats'] }, method: 'PUT' },
  ]);
});

test('suite discovery respects globs, omits subflows, applies order and runs pairing last', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generatorai-mobile-suite-test-'));
  try {
    await fs.mkdir(path.join(dir, 'chat'));
    await fs.mkdir(path.join(dir, '_subflows'));
    await fs.writeFile(path.join(dir, 'config.yaml'), 'flows: ["**/*.yaml", "!chat/omit.yaml"]\nexecutionOrder:\n  flowsOrder: [pair, second, first]\n');
    for (const [file, tags] of [['first', 'smoke'], ['second', 'smoke'], ['pair', 'pairing'], ['omit', 'full']]) {
      await fs.writeFile(path.join(dir, 'chat', `${file}.yaml`), `appId: dev.generatorai.app\ntags: [${tags}]\n---\n- launchApp\n`);
    }
    await fs.writeFile(path.join(dir, '_subflows', 'launch.yaml'), 'appId: dev.generatorai.app\n---\n- launchApp\n');
    assert.deepEqual((await discoverFlows(dir)).entries.map(flow => flow.name), ['second', 'first', 'pair']);
    assert.deepEqual((await discoverFlows(path.join(dir, 'chat'))).entries.map(flow => flow.name), ['second', 'first', 'pair']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('JUnit aggregation preserves failed and skipped cases instead of overwriting earlier flows', () => {
  const report = combineJunitReports([
    '<?xml version="1.0"?><testsuites><testsuite tests="1"><testcase name="one"><failure message="x &amp; y"/></testcase></testsuite></testsuites>',
    '<testsuite tests="1"><testcase name="two"><skipped/></testcase></testsuite>',
    '<testsuites/>',
  ]);
  assert.equal((report.match(/<testcase /g) ?? []).length, 2);
  assert.match(report, /<failure message="x &amp; y"\/>/);
  assert.match(report, /<skipped\/>/);
  assert.throws(() => combineJunitReports(['<html>Unexpected report</html>']), /Unexpected Maestro/);
});
