import { describe, expect, it } from 'vitest';
import { AgentStageSchema, type WorkflowGraph } from '@generatorai/workflow-spec';

import { capabilityRows, formatDuration, insertRef, parseDuration, platformTools, regexProblem, renameStageKey, retryGroupsOn, retryOnFor, retrySentence, setPlatformTool, toggleAdded, undeclaredVariables } from '../stageEditor/stageEditorModel';

const agent = (key: string, extra: Record<string, unknown> = {}) => AgentStageSchema.parse({ kind: 'agent', key, name: key, ...extra });

describe('stage editor model (MD-04 simple fields)', () => {
  it('parses and formats durations', () => {
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('1h 30m')).toBe(5_400_000);
    expect(parseDuration('45')).toBe(45_000);
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('soon')).toBeNull();
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(undefined)).toBe('');
  });

  it('finds undeclared variables and inserts references', () => {
    expect(undeclaredVariables(['Over {{ max_major_bumps }} or {{ risk_threshold }} {{ variables.base }} {{ stages.scan.output }} {{ repo_path_api }}'], ['max_major_bumps'])).toEqual(['risk_threshold', 'base']);
    expect(insertRef('Repo:', 'run.id')).toBe('Repo: {{ run.id }}');
    expect(insertRef('ab', 'x', { start: 1, end: 1 })).toBe('a{{ x }}b');
    expect(regexProblem('(a)\\1')).toMatch(/Backreferences/);
    expect(regexProblem('"risk":\\s*"(low|high)"')).toBeNull();
  });

  it('maps retry groups to retryOn and words the policy', () => {
    expect(retryGroupsOn(undefined)).toHaveLength(4);
    expect(retryOnFor(['rate', 'timeout', 'provider', 'transient'], undefined)).toBeUndefined();
    expect(retryOnFor(['rate'], ['auth'])).toEqual(['auth', 'rate_limited', 'overloaded']);
    expect(retryGroupsOn(['rate_limited'])).toEqual(['rate']);
    expect(retrySentence({ maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 60_000, jitter: 'full', mode: 'resume', restoreCheckpointOnRestart: true })).toBe('Waits 1s, 2s, then pauses for a person after 3 attempts.');
  });

  it('lists capabilities over the agent and sets platform tools', () => {
    const rows = capabilityRows([{ id: 's1', name: 'audit' }, { id: 's2', name: 'docs' }], ['s1'], ['s3'], []);
    expect(rows.map((r) => [r.id, r.on, r.fromAgent])).toEqual([
      ['s1', true, true],
      ['s3', true, false],
      ['s2', false, false],
    ]);
    expect(toggleAdded(['s3'], 's3', false)).toBeUndefined();
    const s = setPlatformTool(agent('a'), 'browser', true);
    expect(platformTools(s, { skillIds: [], mcpServerIds: [], tools: { browser: false } })).toMatchObject({ browser: true, widgets: true, computerUse: false });
  });

  it('renames a key through edges, bodies and context sources', () => {
    const g = { formatVersion: 2, workflow: { name: 'W' }, stages: [agent('a'), agent('b', { context: { from: ['a'] } })], edges: [{ from: 'a', to: 'b', on: 'success' }] } as unknown as WorkflowGraph;
    const r = renameStageKey(g, 'a', 'scan');
    expect(r.stages.map((s) => s.key)).toEqual(['scan', 'b']);
    expect(r.edges[0]).toMatchObject({ from: 'scan', to: 'b' });
    expect((r.stages[1] as { context: { from: string[] } }).context.from).toEqual(['scan']);
  });
});
