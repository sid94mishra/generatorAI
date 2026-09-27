import { describe, expect, it } from 'vitest';
import { collectCommandFields, commandFingerprint, parseGraph, resolveSessionSpec } from '../src/index.js';
import { agent, graph } from './fixtures.js';

describe('resolveSessionSpec', () => {
  it('lets the most specific scalar win and skips missing layers', () => {
    expect(resolveSessionSpec({ model: 'a', maxTurns: 5 }, undefined, { model: 'b' }, null)).toEqual({ model: 'b', maxTurns: 5 });
    expect(resolveSessionSpec()).toEqual({});
  });

  it('unions exclusions and key-merges MCP servers', () => {
    const r = resolveSessionSpec(
      { tools: { available: ['a'], excluded: ['x'] }, mcp: { servers: { s1: { type: 'http', url: 'u1' } }, excludedIds: ['e1'] } },
      { tools: { excluded: ['y', 'x'] }, mcp: { servers: { s1: { type: 'http', url: 'u2' }, s2: { type: 'sse' } }, excludedIds: ['e2'] } },
    );
    expect(r.tools).toEqual({ available: ['a'], excluded: ['x', 'y'] });
    expect(r.mcp).toEqual({ servers: { s1: { type: 'http', url: 'u2' }, s2: { type: 'sse' } }, excludedIds: ['e1', 'e2'] });
  });

  it('merges skills, custom agents, browser and agent overrides', () => {
    const r = resolveSessionSpec(
      {
        skills: { directories: ['d1'], disabled: ['s1'] },
        customAgents: [{ name: 'a', description: 'one', instructions: 'i1' }],
        browser: { enabled: true, mode: 'auto' },
        agentOverrides: { addSkillIds: ['k1'], tools: { shell: false }, appendInstructions: 'w' },
      },
      {
        skills: { disabled: ['s2'] },
        customAgents: [{ name: 'a', description: 'two', instructions: 'i2' }],
        browser: { mode: 'native' },
        agentOverrides: { addSkillIds: ['k2'], tools: { web: true }, appendInstructions: 's' },
      },
    );
    expect(r.skills).toEqual({ directories: ['d1'], disabled: ['s1', 's2'] });
    expect(r.customAgents).toEqual([{ name: 'a', description: 'two', instructions: 'i2' }]);
    expect(r.browser).toEqual({ enabled: true, mode: 'native' });
    expect(r.agentOverrides).toEqual({ addSkillIds: ['k1', 'k2'], tools: { shell: false, web: true }, appendInstructions: 's' });
  });

  it('does not mutate its inputs', () => {
    const a = { tools: { excluded: ['x'] } };
    resolveSessionSpec(a, { tools: { excluded: ['y'] } });
    expect(a).toEqual({ tools: { excluded: ['x'] } });
  });
});

describe('command-bearing registry', () => {
  const g = parseGraph(
    graph(
      [
        agent('a', {
          hooks: [
            { id: 'h1', name: 'h', phase: 'pre_run', type: 'script', config: { type: 'script', command: 'lint', args: ['--fix'] } },
            { id: 'h2', name: 'h', phase: 'post_run', type: 'http', config: { type: 'http', url: 'https://x.test', method: 'GET' } },
          ],
          compensate: [{ name: 'r', config: { type: 'restore_checkpoint' } }, { name: 's', config: { type: 'script', command: 'undo' } }],
          output: { rules: [{ type: 'custom_script', command: 'node', args: ['check.js'] }] },
          session: { mcp: { servers: { fs: { type: 'stdio', command: 'mcp-fs' }, web: { type: 'http', url: 'u' } } } },
        }),
      ],
      [],
      {
        onExit: [{ name: 'f', config: { type: 'function', handlerName: 'notify' } }],
        lifecycle: {
          preprocessingSteps: [
            { name: 'c', config: { type: 'conditional', condition: 'true', thenSteps: [{ name: 'r', config: { type: 'run_script', script: 'npm ci' } }] } },
          ],
          postProcessing: { steps: [{ name: 'p', config: { type: 'run_script', script: 'make' } }] },
        },
      },
    ),
  );

  it('collects every command-bearing field with pointers', () => {
    const fields = collectCommandFields(g).map((f) => [f.kind, f.pointer]);
    expect(fields).toEqual([
      ['action', '/workflow/onExit/0/config'],
      ['preprocessing', '/workflow/lifecycle/preprocessingSteps/0/config/thenSteps/0/config'],
      ['postprocessing', '/workflow/lifecycle/postProcessing/steps/0/config'],
      ['hook', '/stages/0/hooks/0/config'],
      ['compensation', '/stages/0/compensate/1/config'],
      ['mcp', '/stages/0/session/mcp/servers/fs'],
      ['rule', '/stages/0/output/rules/0'],
    ]);
  });

  it('fingerprints commands independently of stage order and prompts', () => {
    const base = commandFingerprint(g);
    const reordered = parseGraph({ ...g, stages: [agent('z'), ...g.stages] });
    expect(commandFingerprint(reordered)).toBe(base);
    const promptEdit = parseGraph({ ...g, stages: [{ ...g.stages[0]!, prompts: [{ label: 'x', text: 'changed' }] }] });
    expect(commandFingerprint(promptEdit)).toBe(base);
    const cmdEdit = parseGraph({
      ...g,
      stages: [{ ...g.stages[0]!, output: { ...g.stages[0]!.output, rules: [{ type: 'custom_script', command: 'rm', args: [] }] } }],
    });
    expect(commandFingerprint(cmdEdit)).not.toBe(base);
  });
});
