// ────────────────────────────────────────────────────────────────
// Presets (P05 ground rule 2): TEMPLATE FUNCTIONS that emit plain stage and
// edge JSON built from the generic kinds (agent, check, loop). The engine
// never knows them: a preset is authoring sugar, and its output is an
// ordinary graph that the builder, import and the authoring tools produce
// the same way. The shipped `templates/system/*-workflow.json` are generated
// from `PRESET_TEMPLATES` (`pnpm generate:templates`, `--check` in lint),
// and `check-workflow-invariants` fails when a preset export name or a
// template id appears in the scheduler or the engine.
//
//   import { fixReviewLoop } from '@generatorai/workflow-spec/presets';
//   const { stages, edges } = fixReviewLoop.build({ maxIterations: 4 });
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { WORKFLOW_FORMAT_VERSION } from '../constants.js';
import type { TEMPLATE_CATEGORIES, WorkflowTemplate } from '../definition.js';
import type { EdgeSpec } from '../schemas/edge.js';
import type { WorkflowGraphInput } from '../schemas/graph.js';
import type { StageSpecSchema } from '../schemas/stage.js';
import type { VariableDefinition } from '../schemas/common.js';
import { validateWorkflow } from '../validate/validateWorkflow.js';

/** A stage as authored (defaults optional). */
export type StageInput = z.input<typeof StageSpecSchema>;
export type EdgeInput = Partial<EdgeSpec> & Pick<EdgeSpec, 'from' | 'to'>;

/** What a preset emits: the loop and its body, ready to splice into a graph. */
export interface PresetFragment {
  stages: StageInput[];
  edges: EdgeInput[];
}

export interface Preset<P extends z.ZodTypeAny> {
  /** The export name (never referenced by engine code). */
  name: string;
  title: string;
  description: string;
  /** Parameters, with defaults: `params.parse({})` is the template's configuration. */
  params: P;
  build(params?: z.input<P>): PresetFragment;
}

const key = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const common = {
  key: key.describe('Key of the loop stage'),
  parentKey: key.optional().describe('Container the loop sits in (nested loops)'),
  onLimit: z.enum(['pause', 'fail', 'accept_last']).default('pause').describe('What exhausting the loop does'),
};

function define<P extends z.ZodTypeAny>(p: Omit<Preset<P>, 'build'> & { make(v: z.output<P>): PresetFragment }): Preset<P> {
  return {
    name: p.name,
    title: p.title,
    description: p.description,
    params: p.params,
    build: (input) => p.make(p.params.parse(input ?? {})),
  };
}

const parent = (v: { parentKey?: string | undefined }) => (v.parentKey ? { parentKey: v.parentKey } : {});

// ── L1: fix → review until approved ─────────────────────────────

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'comments', 'summary'],
  properties: {
    verdict: { enum: ['approve', 'changes_requested'] },
    summary: { type: 'string' },
    comments: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['id', 'severity', 'body'],
        properties: {
          id: { type: 'string' },
          severity: { enum: ['blocker', 'major', 'minor', 'nit'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          body: { type: 'string' },
        },
      },
    },
  },
};

const FIX_SCHEMA = {
  type: 'object',
  required: ['changes', 'addressed'],
  properties: {
    changes: { type: 'string' },
    addressed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'resolution'],
        properties: { id: { type: 'string' }, resolution: { enum: ['fixed', 'wontfix'] }, note: { type: 'string' } },
      },
    },
  },
};

export const fixReviewLoop = define({
  name: 'fixReviewLoop',
  title: 'Fix, then review until approved',
  description: 'A fixer (continuing conversation) and a fresh reviewer alternate until the reviewer approves; stalls when nothing changes twice in a row.',
  params: z
    .object({
      ...common,
      key: common.key.default('fix_review'),
      fixKey: key.default('fix'),
      reviewKey: key.default('review'),
      maxIterations: z.number().int().min(1).max(50).default(5),
      maxTurns: z.number().int().min(1).optional(),
      maxCostUsd: z.number().positive().optional(),
      stallIterations: z.number().int().min(1).max(10).default(2).describe('Iterations without a workspace change before the loop exhausts'),
      fixPrompt: z.string().min(1).default('Fix the issue {{variables.issue_url}}.'),
      reviewPrompt: z.string().min(1).default('Review the diff for {{variables.issue_url}}.'),
    })
    .strict(),
  make: (v) => {
    const budget = v.maxTurns !== undefined || v.maxCostUsd !== undefined ? { budget: { ...(v.maxTurns ? { maxTurns: v.maxTurns } : {}), ...(v.maxCostUsd ? { maxCostUsd: v.maxCostUsd } : {}) } } : {};
    return {
      stages: [
        {
          key: v.key,
          name: 'Fix and review',
          kind: 'loop',
          ...parent(v),
          ...budget,
          loop: {
            maxIterations: v.maxIterations,
            exits: [
              { when: `stages.${v.reviewKey}.output.verdict == 'approve'`, action: 'complete', reason: 'approved' },
              { when: 'not loop.last.signals.workspaceChanged', action: 'exhaust', consecutive: v.stallIterations, reason: 'no_changes' },
            ],
            carry: { openComments: `stages.${v.reviewKey}.output.comments` },
            onLimit: { mode: v.onLimit },
            output: { select: { summary: `loop.last.stages.${v.reviewKey}.output.summary` } },
          },
        },
        {
          key: v.fixKey,
          name: 'Fix',
          kind: 'agent',
          parentKey: v.key,
          sessionReuse: 'continue',
          prompts: [{ label: 'fix', text: v.fixPrompt }],
          followUpPrompts: [
            {
              label: 'address',
              text: 'The reviewer requested changes:\n{{loop.carry.openComments | bullets}}\nAddress each one, run the tests, and report per comment id in `addressed`.',
            },
          ],
          output: { format: 'json', schema: FIX_SCHEMA },
        },
        {
          key: v.reviewKey,
          name: 'Review',
          kind: 'agent',
          parentKey: v.key,
          sessionReuse: 'fresh',
          prompts: [
            {
              label: 'review',
              text: `${v.reviewPrompt}{{#if loop.previous}} Verify these earlier comments were addressed: {{loop.carry.openComments | json}}. Fix report: {{stages.${v.fixKey}.output.addressed | json}}{{/if}}`,
            },
          ],
          output: { format: 'json', schema: REVIEW_SCHEMA },
        },
      ],
      edges: [{ from: v.fixKey, to: v.reviewKey }],
    };
  },
});

// ── L2: test until green ─────────────────────────────────────────

export const testUntilGreen = define({
  name: 'testUntilGreen',
  title: 'Test until green',
  description: 'An agent fixes, a deterministic check runs the tests; the loop ends when the command passes, and exhausts when failures stop decreasing.',
  params: z
    .object({
      ...common,
      key: common.key.default('green'),
      fixKey: key.default('fix'),
      testsKey: key.default('tests'),
      maxIterations: z.number().int().min(1).max(50).default(6),
      command: z.string().min(1).default('pnpm'),
      args: z.array(z.string()).default(['exec', 'vitest', 'run', '--reporter=json', '--silent']),
      timeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
      fixPrompt: z.string().min(1).default('Make the test suite pass without weakening tests.'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Test until green',
        kind: 'loop',
        ...parent(v),
        loop: {
          maxIterations: v.maxIterations,
          exits: [
            { when: `stages.${v.testsKey}.output.passed`, action: 'complete', reason: 'tests_pass' },
            {
              when: `not stages.${v.testsKey}.output.passed and stages.${v.testsKey}.output.json.numFailedTests >= loop.previous.stages.${v.testsKey}.output.json.numFailedTests`,
              action: 'exhaust',
              consecutive: 2,
              reason: 'no_fewer_failures',
            },
          ],
          carry: {
            failures: `map(filter(coalesce(stages.${v.testsKey}.output.json.testResults, []), r => r.status == 'failed'), r => r.message)`,
          },
          onLimit: { mode: v.onLimit },
        },
      },
      {
        key: v.fixKey,
        name: 'Fix',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'continue',
        prompts: [{ label: 'fix', text: v.fixPrompt }],
        followUpPrompts: [{ label: 'retry', text: 'Tests still fail:\n{{loop.carry.failures | bullets}}\nFix the root cause.' }],
      },
      {
        key: v.testsKey,
        name: 'Tests',
        kind: 'check',
        parentKey: v.key,
        check: { command: v.command, args: v.args, parseJson: true, timeoutMs: v.timeoutMs },
      },
    ],
    edges: [{ from: v.fixKey, to: v.testsKey }],
  }),
});

// ── L3: goal-seeking with an evidence audit ──────────────────────

export const goalLoop = define({
  name: 'goalLoop',
  title: 'Goal loop',
  description:
    'A worker pursues an objective in one continuing conversation; a fresh auditor classifies it met, not met, blocked or impossible, with stall and same-blocker rules and a budget wrap-up.',
  params: z
    .object({
      ...common,
      key: common.key.default('goal'),
      workKey: key.default('work'),
      assessKey: key.default('assess'),
      maxIterations: z.number().int().min(1).max(50).default(20),
      maxTurns: z.number().int().min(1).default(400),
      maxTokens: z.number().int().min(1).default(4_000_000),
      compactAfter: z.number().int().min(1).max(20).default(8),
      assessModel: z.string().min(1).optional().describe('Catalog id of the (small) model the auditor uses'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Goal',
        kind: 'loop',
        ...parent(v),
        budget: { maxTurns: v.maxTurns, maxTokens: v.maxTokens },
        loop: {
          maxIterations: v.maxIterations,
          exits: [
            { when: `stages.${v.assessKey}.output.status == 'impossible'`, action: 'fail', reason: 'impossible' },
            { when: `stages.${v.assessKey}.output.status == 'met'`, action: 'complete', reason: 'met' },
            {
              when: `stages.${v.assessKey}.output.status == 'blocked' and stages.${v.assessKey}.output.blocker == loop.previous.stages.${v.assessKey}.output.blocker`,
              action: 'pause',
              consecutive: 2,
              reason: 'same_blocker',
            },
            { when: `loop.last.signals.stages.${v.workKey}.toolCalls == 0`, action: 'exhaust', consecutive: 2, reason: 'no_progress' },
          ],
          carry: { gaps: `coalesce(stages.${v.assessKey}.output.gaps, [])` },
          wrapUp: {
            stage: v.workKey,
            prompt: {
              label: 'wrap_up',
              text: 'Budget reached. Summarise verified progress, remaining work, blockers and the next step. Do not start new work.',
            },
          },
          onLimit: { mode: v.onLimit },
        },
      },
      {
        key: v.workKey,
        name: 'Work',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'continue',
        compactAfter: v.compactAfter,
        prompts: [
          {
            label: 'objective',
            text: 'Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nConstraints: {{variables.constraints}}\nWork from evidence in the current workspace and keep the full objective.',
          },
        ],
        followUpPrompts: [{ label: 'continue', text: 'The assessment found unmet requirements:\n{{loop.carry.gaps | bullets}}\nContinue.' }],
      },
      {
        key: v.assessKey,
        name: 'Assess',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'fresh',
        ...(v.assessModel ? { session: { model: v.assessModel } } : {}),
        prompts: [
          {
            label: 'audit',
            text: 'Objective: {{variables.objective}}\nVerified by: {{variables.verification}}\nAudit whether the objective is met in the current workspace. For each requirement, cite evidence and classify it as proves / contradicts / missing. Uncertain means not met. If blocked, give a short stable identifier in `blocker`.',
          },
        ],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['status', 'gaps'],
            properties: {
              status: { enum: ['met', 'not_met', 'blocked', 'impossible'] },
              blocker: { type: 'string' },
              gaps: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    ],
    edges: [{ from: v.workKey, to: v.assessKey }],
  }),
});

// ── L4: quality refinement, keeping the best ─────────────────────

export const refineUntilScore = define({
  name: 'refineUntilScore',
  title: 'Refine until it scores',
  description: 'A drafter improves its work from a fresh critic’s score and issues; the loop keeps the best-scoring iteration when it runs out.',
  params: z
    .object({
      key: common.key.default('refine'),
      parentKey: common.parentKey,
      draftKey: key.default('draft'),
      critiqueKey: key.default('critique'),
      maxIterations: z.number().int().min(1).max(50).default(4),
      threshold: z.number().min(0).max(10).default(8),
      draftPrompt: z.string().min(1).default('Write the release notes for {{variables.version}}. Output only the notes.'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Refine',
        kind: 'loop',
        ...parent(v),
        loop: {
          maxIterations: v.maxIterations,
          exits: [{ when: `stages.${v.critiqueKey}.output.score >= ${v.threshold}`, action: 'complete', reason: 'good_enough' }],
          carry: { issues: `stages.${v.critiqueKey}.output.issues` },
          onLimit: { mode: 'accept_best', score: `stages.${v.critiqueKey}.output.score` },
          output: { select: { notes: `loop.last.stages.${v.draftKey}.output` } },
        },
      },
      {
        key: v.draftKey,
        name: 'Draft',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'continue',
        prompts: [{ label: 'draft', text: v.draftPrompt }],
        followUpPrompts: [{ label: 'improve', text: 'Improve the draft. Critique:\n{{loop.carry.issues | bullets}}' }],
      },
      {
        key: v.critiqueKey,
        name: 'Critique',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'fresh',
        prompts: [
          {
            label: 'score',
            text: `Score this work 0-10 for accuracy, completeness and clarity, and list concrete issues:\n{{stages.${v.draftKey}.output}}`,
          },
        ],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['score', 'issues'],
            properties: { score: { type: 'number', minimum: 0, maximum: 10 }, issues: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    ],
    edges: [{ from: v.draftKey, to: v.critiqueKey }],
  }),
});

// ── L5: research until nothing new ───────────────────────────────

export const researchUntilDry = define({
  name: 'researchUntilDry',
  title: 'Research until dry',
  description: 'A fresh researcher finds sources each round; the loop accumulates them and completes after rounds that add nothing new.',
  params: z
    .object({
      key: common.key.default('research'),
      parentKey: common.parentKey,
      findKey: key.default('find'),
      maxIterations: z.number().int().min(1).max(50).default(8),
      dryRounds: z.number().int().min(1).max(10).default(2),
      keep: z.number().int().min(1).max(10_000).default(2000),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Research',
        kind: 'loop',
        ...parent(v),
        loop: {
          maxIterations: v.maxIterations,
          carryInit: { seen: '[]' },
          carry: {
            newItems: `diff(stages.${v.findKey}.output.findings, loop.carry.seen, f => f.url)`,
            seen: `take(unique(concat(loop.carry.seen, stages.${v.findKey}.output.findings), f => f.url), ${v.keep})`,
          },
          exits: [{ when: 'len(loop.carry.newItems) == 0', action: 'complete', consecutive: v.dryRounds, reason: 'dry' }],
          output: { select: { findings: 'loop.carry.seen' } },
        },
      },
      {
        key: v.findKey,
        name: 'Find',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'fresh',
        prompts: [
          {
            label: 'find',
            text: 'Find sources on {{variables.topic}}. Do not repeat these URLs:\n{{ take(map(coalesce(loop.carry.seen, []), f => f.url), 200) | bullets }}',
          },
        ],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['findings'],
            properties: {
              findings: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['url', 'title'],
                  properties: { url: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    ],
    edges: [],
  }),
});

// ── Completeness critic (L5-shaped) ──────────────────────────────

export const completenessCritic = define({
  name: 'completenessCritic',
  title: 'Completeness critic',
  description: 'A worker continues until a fresh critic finds nothing missing; the critic’s list is the next iteration’s to-do.',
  params: z
    .object({
      ...common,
      key: common.key.default('complete'),
      workKey: key.default('work'),
      criticKey: key.default('critic'),
      maxIterations: z.number().int().min(1).max(50).default(5),
      taskPrompt: z.string().min(1).default('Complete this task: {{variables.task}}'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Until complete',
        kind: 'loop',
        ...parent(v),
        loop: {
          maxIterations: v.maxIterations,
          exits: [{ when: `len(stages.${v.criticKey}.output.missing) == 0`, action: 'complete', reason: 'complete' }],
          carry: { todo: `stages.${v.criticKey}.output.missing` },
          onLimit: { mode: v.onLimit },
        },
      },
      {
        key: v.workKey,
        name: 'Work',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'continue',
        prompts: [{ label: 'task', text: v.taskPrompt }],
        followUpPrompts: [{ label: 'todo', text: 'A reviewer found these still missing:\n{{loop.carry.todo | bullets}}\nComplete them.' }],
      },
      {
        key: v.criticKey,
        name: 'Critic',
        kind: 'agent',
        parentKey: v.key,
        sessionReuse: 'fresh',
        prompts: [
          {
            label: 'critique',
            text: 'Task: {{variables.task}}\nInspect the current workspace and list everything the task asks for that is still missing or incomplete. Return an empty list only when nothing is missing.',
          },
        ],
        output: {
          format: 'json',
          schema: { type: 'object', required: ['missing'], properties: { missing: { type: 'array', items: { type: 'string' } } } },
        },
      },
    ],
    edges: [{ from: v.workKey, to: v.criticKey }],
  }),
});

/** Every preset, by export name. */
export const PRESETS = { fixReviewLoop, testUntilGreen, goalLoop, refineUntilScore, researchUntilDry, completenessCritic } as const;

// ── Templates generated from the presets ─────────────────────────

interface TemplateSource {
  id: string;
  category: (typeof TEMPLATE_CATEGORIES)[number];
  name: string;
  description: string;
  variables: Array<Partial<VariableDefinition> & Pick<VariableDefinition, 'name' | 'type' | 'label'>>;
  fragment: PresetFragment;
  /** Stages around the loop (the loop is connected after `before` and before `after`). */
  before?: StageInput[];
  after?: StageInput[];
  lifecycle?: Record<string, unknown>;
}

function graphOf(t: TemplateSource): WorkflowGraphInput {
  const loopKey = t.fragment.stages.find((s) => s.kind === 'loop' && !('parentKey' in s && s.parentKey))!.key;
  const edges: EdgeInput[] = [...t.fragment.edges];
  for (const s of t.before ?? []) edges.push({ from: s.key, to: loopKey });
  for (const s of t.after ?? []) edges.push({ from: loopKey, to: s.key });
  return {
    formatVersion: WORKFLOW_FORMAT_VERSION,
    workflow: {
      name: t.name,
      description: t.description,
      variables: t.variables.map((v) => ({ required: true, ...v })) as VariableDefinition[],
      tags: ['loop'],
      ...(t.lifecycle ? { lifecycle: t.lifecycle } : {}),
    },
    stages: [...(t.before ?? []), ...t.fragment.stages, ...(t.after ?? [])] as WorkflowGraphInput['stages'],
    edges: edges as WorkflowGraphInput['edges'],
  };
}

const TEMPLATE_SOURCES: TemplateSource[] = [
  {
    id: 'fix-review-loop',
    category: 'code-review',
    name: 'Fix and review until approved',
    description: 'Triage an issue, then fix and review in a loop until the reviewer approves, then open a pull request.',
    variables: [{ name: 'issue_url', type: 'string', label: 'Issue' }],
    before: [
      {
        key: 'triage',
        name: 'Triage',
        kind: 'agent',
        prompts: [{ label: 'triage', text: 'Triage the issue {{variables.issue_url}}: summarise it, find the files involved and propose a plan.' }],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['summary', 'plan'],
            properties: { summary: { type: 'string' }, plan: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    ],
    fragment: fixReviewLoop.build({
      maxTurns: 250,
      maxCostUsd: 12,
      fixPrompt: 'Fix issue {{variables.issue_url}}. Triage: {{stages.triage.output.summary}}\nPlan:\n{{stages.triage.output.plan | bullets}}',
    }),
    after: [
      {
        key: 'open_pr',
        name: 'Open pull request',
        kind: 'agent',
        prompts: [{ label: 'pr', text: 'Open a pull request for {{variables.issue_url}}. Review summary: {{stages.fix_review.output.summary}}' }],
      },
    ],
  },
  {
    id: 'test-until-green',
    category: 'testing',
    name: 'Test until green',
    description: 'Fix and re-run the test suite until it passes; exhausts when the number of failing tests stops decreasing.',
    variables: [],
    fragment: testUntilGreen.build(),
  },
  {
    id: 'goal-loop',
    category: 'custom',
    name: 'Goal loop',
    description: 'Pursue an objective with an evidence audit after every round, until it is met, impossible or blocked, within a budget.',
    variables: [
      { name: 'objective', type: 'text', label: 'Objective' },
      { name: 'verification', type: 'text', label: 'How it is verified' },
      { name: 'constraints', type: 'text', label: 'Constraints', required: false, defaultValue: 'None' },
    ],
    fragment: goalLoop.build(),
  },
  {
    id: 'refine-until-score',
    category: 'documentation',
    name: 'Refine until it scores',
    description: 'Draft, critique and improve until the critic scores it 8 or more; keeps the best iteration when it runs out.',
    variables: [{ name: 'version', type: 'string', label: 'Version' }],
    fragment: refineUntilScore.build(),
  },
  {
    id: 'research-until-dry',
    category: 'custom',
    name: 'Research until dry',
    description: 'Collect sources on a topic round after round until two rounds find nothing new.',
    variables: [{ name: 'topic', type: 'text', label: 'Topic' }],
    fragment: researchUntilDry.build(),
  },
  {
    id: 'completeness-critic',
    category: 'custom',
    name: 'Completeness critic',
    description: 'Work on a task until a fresh critic finds nothing missing.',
    variables: [{ name: 'task', type: 'text', label: 'Task' }],
    fragment: completenessCritic.build(),
  },
];

/** The templates generated from the presets, as their files carry them (`templates/system/<id>-workflow.json`). */
export function presetTemplates(): WorkflowTemplate[] {
  return TEMPLATE_SOURCES.map((t) => {
    const graph = graphOf(t);
    const r = validateWorkflow(graph);
    if (!r.valid || !r.graph) {
      const errors = r.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} at ${i.path}: ${i.message}`);
      throw new Error(`Preset template ${t.id} is invalid:\n${errors.join('\n')}`);
    }
    return { id: t.id, category: t.category, graph: r.graph };
  });
}

/** Template ids generated from presets (the invariants lint keeps them out of the engine). */
export const PRESET_TEMPLATE_IDS: readonly string[] = TEMPLATE_SOURCES.map((t) => t.id);
