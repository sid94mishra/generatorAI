import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  InvocationRequestSchema,
  InvocationTriggerSchema,
  RunCommandSchema,
  SessionSpecSchema,
  StageSpecSchema,
  ValidationIssueSchema,
  WorkflowGraphSchema,
  exportGraph,
  importGraph,
  parseGraph,
  validateWorkflow,
} from '../src/index.js';
import { descriptionOf, unwrap, walkFields } from '../src/util/zodWalk.js';
import { validGraph } from './arbitraries.js';
import { agent, codes, graph } from './fixtures.js';

describe('R-6: every field is described', () => {
  const roots: Array<[string, z.ZodTypeAny]> = [
    ['WorkflowGraph', WorkflowGraphSchema],
    ['InvocationRequest', InvocationRequestSchema],
    ['InvocationTrigger', InvocationTriggerSchema],
    ['RunCommand', RunCommandSchema],
    ['ValidationIssue', ValidationIssueSchema],
  ];
  it.each(roots)('%s', (_name, root) => {
    const missing: string[] = [];
    let count = 0;
    walkFields(root, (f) => {
      count++;
      if (!descriptionOf(f.schema)) missing.push(f.path);
    });
    expect(count).toBeGreaterThan(3);
    expect(missing).toEqual([]);
  });

  it('every input object is strict', () => {
    const loose: string[] = [];
    const check = (root: z.ZodTypeAny) =>
      walkFields(root, (f) => {
        const s = unwrap(f.schema);
        if (s instanceof z.ZodObject && s._def.unknownKeys !== 'strict') loose.push(f.path);
      });
    check(WorkflowGraphSchema);
    check(InvocationRequestSchema);
    check(RunCommandSchema);
    expect(unwrap(WorkflowGraphSchema)._def.unknownKeys).toBe('strict');
    expect(loose).toEqual([]);
  });
});

describe('strictness and hints', () => {
  it('rejects unknown fields with a hint for renamed ones', () => {
    const r = validateWorkflow(
      graph([agent('a', { condition: { type: 'always' }, harnessConfigOverrides: {} })], [], { copilotConfig: {} }),
    );
    expect(r.valid).toBe(false);
    const byPath = Object.fromEntries(r.issues.map((i) => [i.path, i]));
    expect(byPath['/workflow/copilotConfig']!.code).toBe('unknown-field');
    expect(byPath['/workflow/copilotConfig']!.hint).toMatch(/did you mean `session`/);
    expect(byPath['/stages/0/condition']!.hint).toMatch(/guard/);
    expect(byPath['/stages/0/condition']!.stageKey).toBe('a');
    expect(byPath['/stages/0/harnessConfigOverrides']!.hint).toMatch(/session/);
  });

  it('suggests the nearest sibling for a typo', () => {
    const r = validateWorkflow(graph([agent('a', { sesionReuse: 'fresh' })]));
    expect(r.issues[0]!.code).toBe('unknown-field');
    expect(r.issues[0]!.hint).toMatch(/sessionReuse/);
    const r2 = validateWorkflow(graph([agent('a', { retry: { maxAttempt: 2 } })]));
    expect(r2.issues[0]!.path).toBe('/stages/0/retry/maxAttempt');
    expect(r2.issues[0]!.hint).toMatch(/maxAttempts/);
  });

  it('explains stage kinds that do not exist yet', () => {
    const r = validateWorkflow(graph([{ key: 'l', name: 'l', kind: 'loop' } as never]));
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.hint).toMatch(/not available yet/);
  });

  it('requires formatVersion 2', () => {
    const r = validateWorkflow({ ...graph([agent('a')]), formatVersion: 1 });
    expect(r.issues[0]!.path).toBe('/formatVersion');
    expect(r.issues[0]!.hint).toMatch(/formatVersion/);
  });

  it('rejects keys that are not lower snake case', () => {
    for (const bad of ['Plan', '1a', 'a-b', 'a'.repeat(49), '']) {
      expect(codes(validateWorkflow(graph([agent(bad)])))).toContain('schema');
    }
  });

  it('enforces reserved variable names in the schema', () => {
    for (const name of ['__workingDirectory', 'repo_path_app', 'repo_branch_app', 'stages', 'loop', 'variables', 'maps']) {
      const r = validateWorkflow(graph([agent('a')], [], { variables: [{ name, type: 'string', label: 'x' }] }));
      expect(codes(r), name).toContain('reserved-variable-name');
    }
  });

  it('requires hook type to match config.type', () => {
    const hook = { id: 'h', name: 'h', phase: 'pre_run', type: 'http', config: { type: 'script', command: 'echo' } };
    expect(codes(validateWorkflow(graph([agent('a', { hooks: [hook] })])))).toContain('hook-type-mismatch');
  });

  it('rejects stage hooks on workflow phases and the reverse', () => {
    const hook = (phase: string) => ({ id: 'h', name: 'h', phase, type: 'script', config: { type: 'script', command: 'echo' } });
    expect(codes(validateWorkflow(graph([agent('a', { hooks: [hook('on_run_start')] })])))).toContain('schema');
    expect(codes(validateWorkflow(graph([agent('a')], [], { hooks: [hook('pre_prompt')] })))).toContain('schema');
  });
});

describe('the canonical document', () => {
  it('import(export(g)) ≡ g (property)', () => {
    fc.assert(
      fc.property(validGraph, (input) => {
        const g = parseGraph(input);
        const back = importGraph(exportGraph(g));
        expect(back.valid).toBe(true);
        expect(back.graph).toEqual(g);
        expect(exportGraph(back.graph!)).toBe(exportGraph(g));
      }),
      { numRuns: 200 },
    );
  });

  it('generated graphs validate with no errors (property)', () => {
    fc.assert(
      fc.property(validGraph, (input) => {
        const r = validateWorkflow(input, { engine: 'v1' });
        expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('parsing is idempotent', () => {
    fc.assert(
      fc.property(validGraph, (input) => {
        const once = parseGraph(input);
        expect(parseGraph(once)).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it('reports invalid JSON on import', () => {
    const r = importGraph('{nope');
    expect(r.valid).toBe(false);
    expect(r.issues[0]!.message).toMatch(/Invalid JSON/);
  });
});

describe('other shapes', () => {
  it('StageSpec applies defaults', () => {
    const s = StageSpecSchema.parse({ key: 'a', name: 'A', kind: 'agent' });
    expect(s).toMatchObject({ join: { mode: 'all' }, sessionReuse: 'fresh', prompts: [], hooks: [], context: { mode: 'summary' } });
    expect(s.output).toEqual({ format: 'text', extraction: 'auto', rules: [] });
    expect('onExhausted' in s).toBe(false);
  });

  it('SessionSpec is strict', () => {
    expect(SessionSpecSchema.safeParse({ harnessConfig: {} }).success).toBe(false);
    expect(SessionSpecSchema.safeParse({ model: 'm', mcp: { servers: { s: { type: 'stdio', command: 'x' } } } }).success).toBe(true);
  });

  it('InvocationRequest refuses __* variables and addresses stages by key', () => {
    const base = { target: { kind: 'definition', workflowDefinitionId: '8d7f7c7e-1111-4222-8333-444455556666' } };
    expect(InvocationRequestSchema.safeParse({ ...base, variables: { __projectId: 'x' } }).success).toBe(false);
    expect(InvocationRequestSchema.safeParse({ ...base, stageOverrides: [{ stageKey: 'plan', skip: true }] }).success).toBe(true);
    expect(InvocationRequestSchema.safeParse({ ...base, stageOverrides: [{ stageName: 'Plan' }] }).success).toBe(false);
    expect(InvocationRequestSchema.safeParse({ ...base, trigger: { kind: 'user' } }).success).toBe(false);
  });

  it('RunCommand is a discriminated union with defaults', () => {
    expect(RunCommandSchema.parse({ command: 'pause' })).toEqual({ command: 'pause', mode: 'drain' });
    expect(RunCommandSchema.safeParse({ command: 'grant_iterations', n: 2 }).success).toBe(false);
    expect(RunCommandSchema.parse({ command: 'approve', outcome: 'approved', instanceId: 'x' }).command).toBe('approve');
  });
});
