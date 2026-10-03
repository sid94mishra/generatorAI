import { describe, expect, it } from 'vitest';

import { edgeChips, fileName, missingRequired, stageOutline, variableFields, variablesBody } from '../model/scriptView';

const graph = {
  stages: [
    { key: 'scan', name: 'Scan dependencies', kind: 'agent', session: { agentRef: 'system:security-auditor' } },
    { key: 'fix', name: 'Fix until green', kind: 'loop', loop: { maxIterations: 3 } },
    { key: 'apply', name: 'Apply upgrades', kind: 'agent', parentKey: 'fix', approval: { prompt: 'ok?' } },
    { key: 'pr', name: 'Open PR', kind: 'agent' },
  ],
  edges: [{ from: 'scan', to: 'fix' }, { from: 'fix', to: 'pr' }],
};

describe('script view', () => {
  it('outlines stages with loop bodies indented', () => {
    expect(stageOutline(graph).map((s) => [s.key, s.depth, s.index, s.detail, s.approval])).toEqual([
      ['scan', 0, 1, null, false],
      ['fix', 0, 2, 'Loop · max 3', false],
      ['apply', 1, null, null, true],
      ['pr', 0, 3, null, false],
    ]);
    expect(stageOutline(graph)[0]!.agent).toBe('system:security-auditor');
    expect(edgeChips(graph)).toEqual(['scan → fix', 'fix → pr']);
    expect(stageOutline(null)).toEqual([]);
  });
  it('names the file and builds typed inputs from the profile', () => {
    expect(fileName({ id: 'x', filePath: 'templates/scripts/nightly.workflow.mjs' })).toBe('nightly.workflow.mjs');
    const fields = variableFields({ variables: [{ name: 'base', type: 'string', required: true }, { name: 'max', type: 'number' }, { name: 'dry', type: 'boolean' }] }, { base: 'main', max: 10 });
    expect(fields.map((f) => f.value)).toEqual(['main', '10', '']);
    expect(variablesBody(fields)).toEqual({ base: 'main', max: 10 });
    expect(missingRequired([{ ...fields[0]!, value: ' ' }])).toEqual(['base']);
  });
});
