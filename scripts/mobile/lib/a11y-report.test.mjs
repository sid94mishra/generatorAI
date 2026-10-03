import assert from 'node:assert/strict';
import { test } from 'node:test';
import { a11yMarkdown, auditVerdict } from './a11y-report.mjs';

test('errors and unreachable routes fail; warnings and allowed findings do not', () => {
  const clean = [{ name: 'Home', issues: [] }, { name: 'Chats', issues: [{ level: 'warning', rule: 'duplicate', selector: 'id="x"', message: 'm' }] }];
  assert.equal(auditVerdict(clean).exitCode, 0);
  assert.equal(auditVerdict([...clean, { name: 'Search', failure: 'ready id not found' }]).exitCode, 1);
  assert.equal(auditVerdict([{ name: 'A', issues: [{ level: 'error', rule: 'label', selector: '@3', message: 'no label' }] }]).levels.error, 1);
  assert.equal(auditVerdict([{ name: 'A', issues: [{ level: 'allowed', rule: 'target', selector: 'id="y"', message: 'm' }] }]).exitCode, 0);
});

test('the markdown has one row per finding and escapes table pipes', () => {
  const md = a11yMarkdown({ platform: 'ios', device: 'gai-iphone', textSize: 'large', commit: 'abc', recordedAt: 'now' },
    [{ name: 'Home', issues: [] }, { name: 'A|B', issues: [{ level: 'error', rule: 'label', selector: 'label="x|y"', message: 'no label' }] }]);
  assert.match(md, /\| Home \| clean \|/);
  assert.match(md, /\| A\\\|B \| error \| label \| label="x\\\|y" \| no label \|/);
  assert.match(md, /Errors 1 · warnings 0 · allowed 0/);
});
