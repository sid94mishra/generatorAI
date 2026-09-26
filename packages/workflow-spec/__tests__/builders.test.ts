import { describe, expect, it } from 'vitest';
import { WorkflowBuildError, workflow } from '../src/builders/index.js';
import { AgentStageSchema, WorkflowSpecSchema, exportGraph, importGraph } from '../src/index.js';

const reviewSchema = {
  type: 'object',
  required: ['verdict'],
  properties: { verdict: { enum: ['approve', 'changes_requested'] }, comments: { type: 'array', items: { type: 'string' } } },
};

function full() {
  return workflow('Fix and review')
    .description('Fix an issue, then review it')
    .tags(['demo'])
    .project(null)
    .variable('issue', { type: 'string', label: 'Issue', required: true })
    .variable('env', { type: 'choice', label: 'Env', options: ['dev', 'prod'], defaultValue: 'dev' })
    .model('claude-sonnet-4.6')
    .agent('global:coder', { tools: { web: false } })
    .session({ permissionMode: 'acceptEdits' })
    .lifecycle({ codebaseAliases: ['app'], useWorktree: true, postProcessing: { autoCommit: true } })
    .preprocess({ name: 'branch', config: { type: 'set_variable', variableName: 'branch', value: 'fix/{{issue}}' } })
    .postProcess({ name: 'pr', config: { type: 'create_pr', title: 'Fix {{issue}}', body: '{{ stages.review.output.verdict }}' } })
    .hook({ id: 'start', name: 'start', phase: 'on_run_start', type: 'http', config: { type: 'http', url: 'https://hooks.test/s', method: 'POST' } })
    .hook('on_run_complete', () => undefined)
    .onExit({ name: 'notify', config: { type: 'function', handlerName: 'notify' } })
    .onFailure({ name: 'page', config: { type: 'function', handlerName: 'page' } })
    .budget({ maxTurns: 200 })
    .maxParallel(2)
    .output('verdict', 'stages.review.output.verdict')
    .stage('fix', (s) =>
      s
        .name('Fix')
        .description('Make the change')
        .prompt('Fix {{issue}} on {{ run.codebases.app.path }}', 'fix')
        .followUp('Address the review')
        .sessionReuse('fresh')
        .sessionGroup('coding')
        .retry({ maxAttempts: 3, jitter: 'none' })
        .repair({ maxRepairs: 1 })
        .onExhausted('pause')
        .timeouts({ attemptMs: 600_000, idleMs: 60_000 })
        .budget({ maxCostUsd: 5 })
        .rule({ type: 'min_length', value: 10 })
        .output({ instructions: 'Summarise the diff' })
        .approval({ prompt: 'Look at the diff', maxRounds: 2 })
        .hook('pre_run', () => undefined)
        .compensate({ name: 'undo', config: { type: 'restore_checkpoint' } })
        .position(10, 20),
    )
    .stage('review', (s) =>
      s
        .name('Review')
        .agent('global:reviewer')
        .prompt('Review {{issue}}')
        .outputSchema(reviewSchema)
        .contextFrom(['fix'], 'output')
        .join({ mode: 'all' })
        .guard("variables.env == 'dev' or variables.env == 'prod'"),
    )
    .stage('merge', (s) => s.prompt('Merge').sessionReuse('continue').compactAfter(2).set('output', { format: 'text', extraction: 'auto', rules: [] }).expands({ maxStages: 3 }))
    .edge('fix', 'review', { on: 'success' })
    .edge('review', 'merge', { on: 'completion', when: "stages.review.output.verdict == 'approve'", handlesFailure: true });
}

describe('builders', () => {
  it('emit a canonical WorkflowGraph that round-trips', () => {
    const g = full().build();
    expect(g.formatVersion).toBe(2);
    expect(g.stages.map((s) => s.key)).toEqual(['fix', 'review', 'merge']);
    expect(g.workflow.session).toMatchObject({ model: 'claude-sonnet-4.6', agentRef: 'global:coder', permissionMode: 'acceptEdits' });
    expect(g.stages[1]!.session).toEqual({ agentRef: 'global:reviewer' });
    const back = importGraph(exportGraph(g));
    expect(back.valid).toBe(true);
    expect(back.graph).toEqual(g);
  });

  it('reach every stage and workflow field', () => {
    const g = full().build();
    const stageKeys = new Set(g.stages.flatMap((s) => Object.keys(s)));
    for (const k of Object.keys(AgentStageSchema.shape)) {
      if (k === 'parentKey') continue; // needs a container kind (P05); set with .parent()
      expect(stageKeys.has(k), k).toBe(true);
    }
    for (const k of Object.keys(WorkflowSpecSchema.shape)) expect(k in g.workflow, k).toBe(true);
  });

  it('turn inline handlers into function hooks and return them', () => {
    const { graph, handlers } = full().buildWithHandlers();
    expect([...handlers.keys()]).toEqual(['script:fix_and_review:workflow:on_run_complete:0', 'script:fix_and_review:fix:pre_run:0']);
    const stageHook = graph.stages[0]!.hooks.find((h) => h.config.type === 'function')!;
    expect(stageHook).toMatchObject({ phase: 'pre_run', type: 'function', config: { handlerName: 'script:fix_and_review:fix:pre_run:0' } });
  });

  it('throw WorkflowBuildError with the validator issues', () => {
    try {
      workflow('bad').stage('a', (s) => s.prompt('{{nope}}')).edge('a', 'b').build();
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowBuildError);
      expect((err as WorkflowBuildError).issues.map((i) => i.code)).toEqual(['unknown-edge-target', 'template-unknown-variable']);
      expect((err as Error).message).toMatch(/unknown-edge-target at \/edges\/0\/to/);
    }
  });

  it('refuse duplicate stage keys and chain stages', () => {
    expect(() => workflow('w').stage('a').stage('a')).toThrow(/twice/);
    const g = workflow('w').stage('a', (s) => s.prompt('a')).stage('b', (s) => s.prompt('b')).stage('c', (s) => s.prompt('c')).chain('a', 'b', 'c').build();
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>b', 'b>c']);
  });

  it('validate without throwing', () => {
    const r = workflow('w').stage('a', (s) => s.prompt('{{nope}}')).validate();
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(['template-unknown-variable']);
  });
});
