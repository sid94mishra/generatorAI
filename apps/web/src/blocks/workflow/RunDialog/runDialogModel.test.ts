import { describe, expect, it } from 'vitest';
import type { VariableDefinition } from '@generatorai/workflow-spec';
import { blankStageOverrides, type CodebaseDraft } from '@generatorai/client-core';
import {
  EMPTY_RUN_OPTIONS,
  buildInvocationRequest,
  convertVariables,
  parseStageVariables,
  seedValue,
  validateVariables,
  withStageVariables,
} from './runDialogModel.js';

const v = (over: Partial<VariableDefinition> & Pick<VariableDefinition, 'name' | 'type'>): VariableDefinition =>
  ({ label: over.name, required: false, ...over }) as VariableDefinition;

const target = { kind: 'definition', workflowDefinitionId: '00000000-0000-4000-8000-000000000001' } as const;

describe('seedValue', () => {
  it('coerces boolean defaults and renders list/json for editing', () => {
    expect(seedValue(v({ name: 'b', type: 'boolean', defaultValue: 'false' }))).toBe(false);
    expect(seedValue(v({ name: 'b', type: 'boolean', defaultValue: 'true' }))).toBe(true);
    expect(seedValue(v({ name: 'l', type: 'list', defaultValue: ['a', 'b'] }))).toBe('a\nb');
    expect(seedValue(v({ name: 'j', type: 'json', defaultValue: { a: 1 } }))).toBe('{\n  "a": 1\n}');
    expect(seedValue(v({ name: 's', type: 'string' }))).toBe('');
  });
});

describe('validateVariables', () => {
  it('flags required, number, json and choice errors', () => {
    const errors = validateVariables(
      [
        v({ name: 'req', type: 'string', required: true }),
        v({ name: 'num', type: 'number' }),
        v({ name: 'js', type: 'json' }),
        v({ name: 'ch', type: 'choice', options: ['a', 'b'] }),
        v({ name: 'ok', type: 'string' }),
      ],
      { req: '', num: 'x', js: '{', ch: 'c', ok: 'fine' },
    );
    expect(Object.keys(errors).sort()).toEqual(['ch', 'js', 'num', 'req']);
  });
});

describe('convertVariables', () => {
  it('types values, falls back to defaults and fills git variables from the first mount', () => {
    const vars = [
      v({ name: 'n', type: 'number' }),
      v({ name: 'b', type: 'boolean' }),
      v({ name: 'l', type: 'list' }),
      v({ name: 'j', type: 'json' }),
      v({ name: 'd', type: 'string', defaultValue: 'dflt' }),
      v({ name: 'repo_url', type: 'string' }),
      v({ name: 'branch', type: 'string' }),
    ];
    const codebases: CodebaseDraft[] = [{ alias: 'api', selected: true, baseRef: '', mode: 'worktree' }];
    const out = convertVariables(
      vars,
      { n: '3', b: 'true', l: ' x \n\n y ', j: '{"a":1}', d: '', repo_url: 'typed', branch: 'typed' },
      { alias: 'api', url: 'https://example.test/api.git', defaultBranch: 'develop' },
      codebases,
    );
    expect(out).toEqual({ n: 3, b: true, l: ['x', 'y'], j: { a: 1 }, d: 'dflt', repo_url: 'https://example.test/api.git', branch: 'develop' });
    expect(convertVariables([v({ name: 'n', type: 'number' })], { n: '' }, undefined, [])).toEqual({ n: undefined });
  });
});

describe('parseStageVariables', () => {
  it('types scalars and reports the first bad line', () => {
    expect(parseStageVariables('a=1\nb=true\n# note\nc=hello\nd=null')).toEqual({
      variables: { a: 1, b: true, c: 'hello', d: null },
      error: null,
    });
    expect(parseStageVariables('ok=1\nnope').error).toBe('Line 2: use key=value.');
    expect(parseStageVariables('__x=1').error).toMatch(/reserved/);
    expect(parseStageVariables('1bad=1').error).toMatch(/not a valid variable name/);
  });
});

describe('buildInvocationRequest', () => {
  it('sends only what changed', () => {
    const req = buildInvocationRequest({
      target,
      variables: {},
      stageOverrides: blankStageOverrides([{ key: 's', name: 'S' }]),
      codebases: [],
      options: EMPTY_RUN_OPTIONS,
    });
    expect(req).toEqual({ target, variables: {}, client: 'web' });
  });

  it('carries overrides, codebases, name and the wall-clock budget', () => {
    const drafts = withStageVariables(
      blankStageOverrides([
        { key: 'a', name: 'A' },
        { key: 'b', name: 'B' },
      ]).map((o) => (o.stageKey === 'b' ? { ...o, skip: true } : o)),
      { a: 'x=2' },
    );
    const req = buildInvocationRequest({
      target,
      variables: { v: 1 },
      stageOverrides: drafts,
      codebases: [
        { alias: 'api', selected: true, baseRef: ' main ', mode: 'in_place' },
        { alias: 'web', selected: false, baseRef: '', mode: 'worktree' },
      ],
      options: { model: 'm1', effort: 'high', permissionMode: 'acceptEdits', runName: ' Nightly ', stopAfterMinutes: '30' },
    });
    expect(req).toMatchObject({
      stageOverrides: [
        { stageKey: 'a', variables: { x: 2 } },
        { stageKey: 'b', skip: true },
      ],
      codebases: [{ alias: 'api', mode: 'in_place', baseRef: 'main' }],
      overrides: { model: 'm1', reasoningEffort: 'high', permissionMode: 'acceptEdits' },
      name: 'Nightly',
      budget: { maxDurationMs: 1_800_000 },
    });
    expect(buildInvocationRequest({ target, variables: {}, stageOverrides: [], codebases: [], options: { ...EMPTY_RUN_OPTIONS, stopAfterMinutes: '0' } }).budget).toBeUndefined();
  });
});
