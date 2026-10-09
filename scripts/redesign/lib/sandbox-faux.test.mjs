import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeFauxScripts, prepareSandboxFauxScript, sandboxFauxSources } from './sandbox-faux.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('the default sandbox script carries the e2e conversations (composer, changes-dock)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-sandbox-faux-'));
  try {
    const { file } = prepareSandboxFauxScript(ROOT, dir, {});
    const names = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
    for (const name of ['Sandbox — Active Chat', 'E2E Composer Faux', 'E2E Changes Faux']) assert.ok(names.includes(name), name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GENERATORAI_SANDBOX_FAUX_SCRIPT is used as-is; GENERATORAI_TEST_FAUX_SCRIPT is merged last', () => {
  assert.deepEqual(prepareSandboxFauxScript(ROOT, os.tmpdir(), { GENERATORAI_SANDBOX_FAUX_SCRIPT: '/x/mobile.json' }), {
    file: '/x/mobile.json',
    sources: [],
  });
  const sources = sandboxFauxSources(ROOT, { GENERATORAI_TEST_FAUX_SCRIPT: '/x/extra.json' });
  assert.equal(sources.at(-1), path.resolve('/x/extra.json'));
  assert.match(sources[0], /sandbox\.faux\.json$/);
  const fixture = path.join(ROOT, 'agent-tests', 'e2e', 'fixtures', 'faux-composer-changes.json');
  const again = sandboxFauxSources(ROOT, { GENERATORAI_TEST_FAUX_SCRIPT: fixture });
  assert.equal(again.filter((f) => f === fixture).length, 1);
  assert.doesNotThrow(() => mergeFauxScripts(again));
});

test('a conversation scripted twice is an error, not a silent override', () => {
  const files = { a: '{"Chat":[[]]}', b: '{"Other":[[]]}', c: '{"Chat":[[]]}' };
  assert.deepEqual(Object.keys(mergeFauxScripts(['a', 'b'], (f) => files[f])), ['Chat', 'Other']);
  assert.throws(() => mergeFauxScripts(['a', 'c'], (f) => files[f]), /scripted by both a and c/);
  assert.throws(() => mergeFauxScripts(['x'], () => '[]'), /keyed by conversation name/);
});
