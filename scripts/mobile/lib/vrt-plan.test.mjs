import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { baselineFile, capturePlan, captureUrl, deviceMismatch, literal, parseVariant, summarize, variantsFor, vrtParams } from './vrt-plan.mjs';

const obj = (props) => ({ type: 'ObjectExpression', properties: Object.entries(props).map(([key, value]) => ({ type: 'ObjectProperty', key: { type: 'Identifier', name: key }, value })) });
const str = (value) => ({ type: 'StringLiteral', value });

test('vrt parameters are read from literal AST only; the story overrides the meta', () => {
  const meta = obj({ vrt: obj({ accents: { type: 'BooleanLiteral', value: true } }) });
  const story = obj({ vrt: obj({ skip: str('animated') }) });
  assert.deepEqual(vrtParams(meta, story), { accents: true, skip: 'animated' });
  assert.deepEqual(vrtParams(undefined, undefined), {});
  assert.equal(literal({ type: 'Identifier', name: 'x' }), undefined);
  assert.equal(literal({ type: 'ObjectExpression', properties: [{ type: 'SpreadElement' }] }), undefined);
});

test('variants: the default five, a replacement list, six accents, none when skipped', () => {
  assert.equal(variantsFor().length, 5);
  assert.deepEqual(variantsFor({ variants: ['instrument-dark-default'] }), ['instrument-dark-default']);
  const accents = variantsFor({ accents: true });
  assert.equal(accents.length, 11);
  assert.ok(accents.includes('instrument-dark-default-teal'));
  assert.deepEqual(variantsFor({ skip: 'native only' }), []);
});

test('variant names parse, links carry theme/mode/accent, baselines are per platform and device', () => {
  assert.deepEqual(parseVariant('solarized-light-ax'), { theme: 'solarized', mode: 'light', textSize: 'ax', accent: 'ink' });
  assert.deepEqual(parseVariant('instrument-dark-default-rose'), { theme: 'instrument', mode: 'dark', textSize: 'default', accent: 'rose' });
  assert.throws(() => parseVariant('instrument-dim'));
  const url = new URL(captureUrl('ui-primitives-badge--all-tones', 'instrument-dark-ax'));
  assert.equal(url.protocol, 'generatorai:');
  assert.deepEqual(Object.fromEntries(url.searchParams), { story: 'ui-primitives-badge--all-tones', theme: 'instrument', mode: 'dark', accent: 'ink' });
  assert.equal(baselineFile('/r', 'ios', 'phone', 's--x', 'instrument-dark-ax'), path.join('/r', 'apps/mobile/vrt/baselines/ios/phone/s--x--instrument-dark-ax.png'));
});

test('the plan groups captures by text size and honours grep and the variant filter', () => {
  const stories = [{ id: 'ui-a--x', vrt: {} }, { id: 'ui-b--y', vrt: {} }, { id: 'ui-c--z', vrt: { skip: 'no' } }];
  const plan = capturePlan(stories);
  assert.equal(plan.length, 10);
  const sizes = plan.map((item) => item.textSize);
  assert.equal(new Set(sizes).size, 2);
  assert.equal(sizes.filter((size, i) => i > 0 && size !== sizes[i - 1]).length, 1, 'one block per text size');
  assert.equal(capturePlan(stories, { grep: '^ui-b' }).length, 5);
  assert.equal(capturePlan(stories, { variants: ['instrument-dark-default'] }).length, 2);
});

test('a baseline recorded on another device is refused; results fail on diffs unless updating', () => {
  assert.equal(deviceMismatch(null, { deviceType: 'iPhone 18 Pro' }), null);
  assert.equal(deviceMismatch({ deviceType: 'iPhone 18 Pro', runtime: 'iOS 27.0' }, { deviceType: 'iPhone 18 Pro', runtime: 'iOS 27.0' }), null);
  assert.match(deviceMismatch({ deviceType: 'iPhone 18 Pro', runtime: 'iOS 27.0' }, { deviceType: 'iPhone 18 Pro', runtime: 'iOS 27.1' }), /runtime/);
  assert.equal(summarize([{ status: 'match' }, { status: 'diff' }]).exitCode, 1);
  assert.equal(summarize([{ status: 'match' }, { status: 'missing' }]).exitCode, 1);
  assert.equal(summarize([{ status: 'updated' }, { status: 'match' }], { update: true }).exitCode, 0);
  assert.equal(summarize([{ status: 'failed' }], { update: true }).exitCode, 1);
});
