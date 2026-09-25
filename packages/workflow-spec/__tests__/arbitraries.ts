// fast-check arbitraries for valid workflow graphs.
import fc from 'fast-check';
import type { WorkflowGraphInput } from '../src/index.js';

/** Free text that is not a template. */
const text = (max: number) => fc.string({ maxLength: max }).filter((t) => !t.includes('{{') && !t.includes('\\'));

const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);

const prompt = fc.record({
  label: fc.string({ minLength: 1, maxLength: 20 }),
  text: fc.string({ minLength: 1, maxLength: 60 }).filter((t) => !t.includes('{{') && !t.includes('\\')),
});

const variable = fc.record(
  {
    name: fc.stringMatching(/^v_[a-z0-9]{1,6}$/),
    type: fc.constantFrom('string', 'number', 'boolean', 'text'),
    label: fc.string({ minLength: 1, maxLength: 20 }),
    description: fc.string({ maxLength: 30 }),
    required: fc.boolean(),
  },
  { requiredKeys: ['name', 'type', 'label'] },
);

const retry = fc.record(
  {
    maxAttempts: fc.integer({ min: 1, max: 10 }),
    initialDelayMs: fc.integer({ min: 0, max: 5000 }),
    backoffMultiplier: fc.integer({ min: 1, max: 5 }),
    maxDelayMs: fc.integer({ min: 5000, max: 60000 }),
    jitter: fc.constantFrom('full', 'equal', 'none'),
    retryOn: fc.subarray(['rate_limited', 'overloaded', 'transport'] as const),
    mode: fc.constantFrom('resume', 'restart'),
  },
  { requiredKeys: [] },
);

const session = fc.record(
  {
    model: fc.constantFrom('claude-sonnet-4.6', 'gpt-5'),
    harnessType: fc.constantFrom('copilot', 'claude-agent', 'codex'),
    reasoningEffort: fc.constantFrom('low', 'high'),
    maxTurns: fc.integer({ min: 1, max: 100 }),
    agentRef: fc.constantFrom('global:reviewer', 'system:coder'),
    permissionMode: fc.constantFrom('default', 'acceptEdits', 'plan', 'bypassPermissions'),
    defaultAgentMode: fc.constantFrom('auto', 'plan'),
    tools: fc.record({ excluded: fc.array(fc.constantFrom('bash', 'web'), { maxLength: 2 }) }),
    widgets: fc.boolean(),
  },
  { requiredKeys: [] },
);

/** A graph that validates with no errors on engine v1. Edges go from lower to higher index (acyclic). */
export const validGraph: fc.Arbitrary<WorkflowGraphInput> = fc
  .uniqueArray(key, { minLength: 1, maxLength: 8 })
  .chain((keys) => {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) pairs.push([i, j]);
    const stage = (k: string) =>
      fc.record(
        {
          key: fc.constant(k),
          name: fc.string({ minLength: 1, maxLength: 30 }),
          kind: fc.constant('agent' as const),
          description: fc.string({ maxLength: 40 }),
          prompts: fc.array(prompt, { minLength: 1, maxLength: 3 }),
          session,
          retry,
          timeouts: fc.record({ attemptMs: fc.integer({ min: 1000, max: 600000 }) }),
          onExhausted: fc.constant('fail' as const),
          approval: fc.record({ prompt: text(30), maxRounds: fc.integer({ min: 1, max: 5 }) }, { requiredKeys: [] }),
          context: fc.record({ mode: fc.constantFrom('summary', 'output', 'structured', 'none') }),
          output: fc.record({ format: fc.constant('text' as const), rules: fc.constant([{ type: 'min_length' as const, value: 1 }]) }),
          position: fc.record({ x: fc.integer({ min: -500, max: 500 }), y: fc.integer({ min: -500, max: 500 }) }),
        },
        { requiredKeys: ['key', 'name', 'kind', 'prompts'] },
      );
    return fc.record({
      stages: fc.tuple(...keys.map(stage)),
      edges: fc.subarray(pairs).chain((chosen) =>
        fc.tuple(
          ...chosen.map(([a, b]) =>
            fc.record(
              {
                from: fc.constant(keys[a]!),
                to: fc.constant(keys[b]!),
                on: fc.constantFrom('success', 'failure', 'completion', 'always'),
                when: fc.constantFrom("parent.status == 'completed'", "parent.status != 'failed'"),
              },
              { requiredKeys: ['from', 'to'] },
            ),
          ),
        ),
      ),
      variables: fc.uniqueArray(variable, { maxLength: 4, selector: (v) => v.name }),
      tags: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
    });
  })
  .map(
    ({ stages, edges, variables, tags }) =>
      ({
        formatVersion: 2,
        workflow: { name: 'generated', variables, tags, lifecycle: { codebaseAliases: ['app'] } },
        stages,
        edges,
      }) as WorkflowGraphInput,
  );
