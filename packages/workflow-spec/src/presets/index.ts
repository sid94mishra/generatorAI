// ────────────────────────────────────────────────────────────────
// Presets (P05 ground rule 2): TEMPLATE FUNCTIONS that emit plain stage and
// edge JSON built from the generic kinds (agent, check, loop, map, wait,
// subworkflow). The engine
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

// ── Map presets (P05 §4.1) ───────────────────────────────────────

const FILES_SCHEMA = {
  type: 'object',
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      maxItems: 100,
      items: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, reason: { type: 'string' } } },
    },
  },
};

const setupCommand = z
  .object({ command: z.string().min(1), args: z.array(z.string()).default([]) })
  .strict()
  .describe('A command run in each item mount before its body (for example pnpm install --offline)');

// M1: per-file migration, one worktree and one pull request per file.
export const perFileMigration = define({
  name: 'perFileMigration',
  title: 'Per-file migration',
  description: 'A scan lists the files to change; each file is migrated in its own worktree cut from the run mounts, and gets its own branch and pull request.',
  params: z
    .object({
      key: key.default('per_file').describe('Key of the map stage'),
      parentKey: key.optional().describe('Container the map sits in'),
      scanKey: key.default('scan'),
      bodyKey: key.default('migrate'),
      maxItems: z.number().int().min(1).max(200).default(50),
      concurrency: z.number().int().min(1).max(16).default(4),
      toleratedFailurePercent: z.number().min(0).max(100).default(0),
      merge: z.enum(['pr_per_item', 'sequential', 'none']).default('pr_per_item'),
      itemSetup: z.array(setupCommand).max(5).default([]),
      scanPrompt: z.string().min(1).default('List every file that must change for this migration: {{variables.change}}. Give a one-line reason per file.'),
      migratePrompt: z.string().min(1).default('Apply this migration to {{item.path}} only: {{variables.change}}\nWhy this file: {{item.reason}}'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.scanKey,
        name: 'Scan',
        kind: 'agent',
        ...parent(v),
        prompts: [{ label: 'scan', text: v.scanPrompt }],
        output: { format: 'json', schema: FILES_SCHEMA },
      },
      {
        key: v.key,
        name: 'Per file',
        kind: 'map',
        ...parent(v),
        map: {
          items: `stages.${v.scanKey}.output.files`,
          itemKey: 'item.path',
          maxItems: v.maxItems,
          concurrency: v.concurrency,
          toleratedFailurePercent: v.toleratedFailurePercent,
          workspace: 'mount_per_item',
          merge: v.merge,
          ...(v.itemSetup.length > 0 ? { itemSetup: v.itemSetup.map((c) => ({ command: c.command, args: c.args })) } : {}),
        },
      },
      {
        key: v.bodyKey,
        name: 'Migrate file',
        kind: 'agent',
        parentKey: v.key,
        prompts: [{ label: 'migrate', text: v.migratePrompt }],
      },
    ],
    edges: [{ from: v.scanKey, to: v.key }],
  }),
});

// L6: plan, fan out per file, verify — repeated until the typecheck is clean.
export const migrateUntilClean = define({
  name: 'migrateUntilClean',
  title: 'Migrate until clean',
  description: 'Each round plans the files that still need changes, migrates them in parallel (a worktree per file, merged back one by one) and runs the typecheck, until it passes.',
  params: z
    .object({
      ...common,
      key: common.key.default('migrate_until_clean'),
      planKey: key.default('plan'),
      mapKey: key.default('per_file'),
      editKey: key.default('edit'),
      checkKey: key.default('typecheck'),
      maxIterations: z.number().int().min(1).max(50).default(3),
      concurrency: z.number().int().min(1).max(16).default(4),
      command: z.string().min(1).default('pnpm'),
      args: z.array(z.string()).default(['typecheck']),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Migrate until clean',
        kind: 'loop',
        ...parent(v),
        loop: {
          maxIterations: v.maxIterations,
          exits: [{ when: `stages.${v.checkKey}.output.passed`, action: 'complete', reason: 'clean' }],
          onLimit: { mode: v.onLimit },
        },
      },
      {
        key: v.planKey,
        name: 'Plan',
        kind: 'agent',
        parentKey: v.key,
        prompts: [{ label: 'plan', text: 'List every file that must change to migrate to the new API.' }],
        followUpPrompts: [
          {
            label: 'replan',
            text: `Typecheck still fails:\n{{loop.previous.stages.${v.checkKey}.output.stdoutTail}}\nList only the files that still need changes.`,
          },
        ],
        output: { format: 'json', schema: FILES_SCHEMA },
      },
      {
        key: v.mapKey,
        name: 'Per file',
        kind: 'map',
        parentKey: v.key,
        map: {
          items: `stages.${v.planKey}.output.files`,
          itemKey: 'item.path',
          maxItems: 100,
          concurrency: v.concurrency,
          workspace: 'mount_per_item',
          merge: 'sequential',
        },
      },
      {
        key: v.editKey,
        name: 'Edit',
        kind: 'agent',
        parentKey: v.mapKey,
        prompts: [{ label: 'edit', text: 'Migrate {{item.path}} to the new API. Reason: {{item.reason}}' }],
      },
      {
        key: v.checkKey,
        name: 'Typecheck',
        kind: 'check',
        parentKey: v.key,
        check: { command: v.command, args: v.args, timeoutMs: 900_000 },
      },
    ],
    edges: [
      { from: v.planKey, to: v.mapKey },
      { from: v.mapKey, to: v.checkKey },
    ],
  }),
});

// M2: research several sources in parallel (read-only), then synthesize.
export const multiSourceResearch = define({
  name: 'multiSourceResearch',
  title: 'Multi-source research',
  description: 'Research each source of a list in parallel with a read-only agent, then synthesize the findings.',
  params: z
    .object({
      key: key.default('sources_map').describe('Key of the map stage'),
      bodyKey: key.default('research'),
      synthesizeKey: key.default('synthesize'),
      items: z.string().min(1).default('variables.sources').describe('The list expression'),
      concurrency: z.number().int().min(1).max(16).default(4),
      maxItems: z.number().int().min(1).max(200).default(20),
      toleratedFailurePercent: z.number().min(0).max(100).default(25),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Per source',
        kind: 'map',
        map: {
          items: v.items,
          maxItems: v.maxItems,
          concurrency: v.concurrency,
          toleratedFailurePercent: v.toleratedFailurePercent,
          workspace: 'shared',
          merge: 'none',
        },
      },
      {
        key: v.bodyKey,
        name: 'Research source',
        kind: 'agent',
        parentKey: v.key,
        // Read-only: several items share one workspace.
        session: { permissionMode: 'plan' },
        prompts: [{ label: 'research', text: 'Research {{variables.topic}} in this source: {{item}}. Report what it says, with quotes and links.' }],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['summary', 'findings'],
            properties: {
              summary: { type: 'string' },
              findings: { type: 'array', items: { type: 'object', required: ['claim'], properties: { claim: { type: 'string' }, evidence: { type: 'string' } } } },
            },
          },
        },
      },
      {
        key: v.synthesizeKey,
        name: 'Synthesize',
        kind: 'agent',
        prompts: [
          {
            label: 'synthesize',
            text: `Synthesize what the sources say about {{variables.topic}}. Note agreements and contradictions.\n{{ map(stages.${v.key}.output.results, r => r.stages.${v.bodyKey}.output) | json }}`,
          },
        ],
      },
    ],
    edges: [{ from: v.key, to: v.synthesizeKey }],
  }),
});

// M3: every finding verified independently from three angles; confirmed by two of three.
export const adversarialVerify = define({
  name: 'adversarialVerify',
  title: 'Adversarial verification',
  description: 'An audit lists findings; each finding is verified independently from three angles by read-only agents that default to "not real", and is confirmed only when two of three agree.',
  params: z
    .object({
      key: key.default('verify_findings').describe('Key of the outer map'),
      auditKey: key.default('audit'),
      anglesKey: key.default('verify_map'),
      verifyKey: key.default('verify'),
      angles: z.array(z.string().min(1)).min(1).max(10).default(['correctness', 'security', 'reproducibility']),
      needed: z.number().int().min(1).max(10).default(2).describe('Angles that must confirm a finding'),
      maxItems: z.number().int().min(1).max(200).default(50),
      concurrency: z.number().int().min(1).max(16).default(4),
      auditPrompt: z.string().min(1).default('Audit {{variables.target}}. List each potential problem as a finding with a short stable id and a precise claim.'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.auditKey,
        name: 'Audit',
        kind: 'agent',
        prompts: [{ label: 'audit', text: v.auditPrompt }],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['findings'],
            properties: {
              findings: {
                type: 'array',
                maxItems: 50,
                items: { type: 'object', required: ['id', 'claim'], properties: { id: { type: 'string' }, claim: { type: 'string' }, location: { type: 'string' } } },
              },
            },
          },
        },
      },
      {
        key: v.key,
        name: 'Verify findings',
        kind: 'map',
        map: {
          items: `stages.${v.auditKey}.output.findings`,
          itemKey: 'item.id',
          maxItems: v.maxItems,
          concurrency: v.concurrency,
          workspace: 'shared',
          merge: 'none',
          output: { select: { confirmed: `count(stages.${v.anglesKey}.output.results, r => r.stages.${v.verifyKey}.output.real) >= ${v.needed}` } },
        },
      },
      {
        key: v.anglesKey,
        name: 'Verify from each angle',
        kind: 'map',
        parentKey: v.key,
        map: {
          items: `[${v.angles.map((a) => `'${a.replace(/'/g, '')}'`).join(', ')}]`,
          maxItems: v.angles.length,
          concurrency: v.angles.length,
          workspace: 'shared',
          merge: 'none',
        },
      },
      {
        key: v.verifyKey,
        name: 'Verify',
        kind: 'agent',
        parentKey: v.anglesKey,
        // No write tools: the verifiers share the workspace.
        session: { permissionMode: 'plan' },
        prompts: [
          {
            label: 'verify',
            text: `Independently verify this finding from the {{item}} angle. Default to real=false unless you can demonstrate it:\n{{maps.${v.key}.item | json}}`,
          },
        ],
        output: {
          format: 'json',
          schema: { type: 'object', required: ['real', 'evidence'], properties: { real: { type: 'boolean' }, evidence: { type: 'string' } } },
        },
      },
    ],
    edges: [{ from: v.auditKey, to: v.key }],
  }),
});

// P08 §7 judge panel / best-of-N: candidates from several angles, a judge, only the winner merged.
export const judgePanel = define({
  name: 'judgePanel',
  title: 'Judge panel (best of N)',
  description:
    'Several agents solve the same task from different angles, each in its own worktree; a read-only judge compares them, and only the winner it picks is merged into the run mount.',
  params: z
    .object({
      key: key.default('panel').describe('Key of the map stage'),
      parentKey: key.optional().describe('Container the panel sits in'),
      attemptKey: key.default('attempt'),
      judgeKey: key.default('judge'),
      angles: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'lower case, digits, - and _'))
        .min(2)
        .max(8)
        .default(['minimal', 'thorough', 'idiomatic'])
        .describe('One candidate per angle; the angle is its item key'),
      toleratedFailurePercent: z.number().min(0).max(100).default(50).describe('Candidates that may fail before the panel fails'),
      itemSetup: z.array(setupCommand).max(5).default([]),
      attemptPrompt: z
        .string()
        .min(1)
        .default(
          'Solve this task: {{variables.task}}\nTake the {{item}} approach. Work only in this worktree, run the relevant tests, then report a summary, the files you changed and the risks you see.',
        ),
    })
    .strict()
    .refine((v) => new Set(v.angles).size === v.angles.length, { message: 'angles must be unique', path: ['angles'] }),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Candidates',
        kind: 'map',
        ...parent(v),
        map: {
          items: `[${v.angles.map((a) => `'${a}'`).join(', ')}]`,
          itemKey: 'item',
          maxItems: v.angles.length,
          concurrency: v.angles.length,
          toleratedFailurePercent: v.toleratedFailurePercent,
          workspace: 'mount_per_item',
          merge: { mode: 'winner', key: `stages.${v.judgeKey}.output.winner` },
          ...(v.itemSetup.length > 0 ? { itemSetup: v.itemSetup.map((c) => ({ command: c.command, args: c.args })) } : {}),
        },
      },
      {
        key: v.attemptKey,
        name: 'Candidate',
        kind: 'agent',
        parentKey: v.key,
        prompts: [{ label: 'attempt', text: v.attemptPrompt }],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['summary', 'files'],
            properties: {
              summary: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
              risks: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      {
        key: v.judgeKey,
        name: 'Judge',
        kind: 'agent',
        ...parent(v),
        // Read-only: the judge compares; the engine merges the winner it picks.
        session: { permissionMode: 'plan' },
        prompts: [
          {
            label: 'judge',
            text: `Task: {{variables.task}}\nIndependent candidates solved it, one per angle, each in its own git worktree (its \`workdir\` below). Compare them for correctness, completeness, test results and risk; read their changed files in their workdirs where you need to. Score every candidate 0-10 and pick the best one as \`winner\` (its key).\n{{ stages.${v.key}.output.results | json }}`,
          },
        ],
        output: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['winner', 'scores', 'rationale'],
            properties: {
              winner: { enum: v.angles },
              scores: {
                type: 'array',
                items: { type: 'object', required: ['candidate', 'score'], properties: { candidate: { enum: v.angles }, score: { type: 'number', minimum: 0, maximum: 10 }, notes: { type: 'string' } } },
              },
              rationale: { type: 'string' },
            },
          },
        },
      },
    ],
    edges: [{ from: v.key, to: v.judgeKey }],
  }),
});

// P08 §8 plan-then-execute: a planner outputs a plan of agent stages; the engine validates and runs it.
export const planThenExecute = define({
  name: 'planThenExecute',
  title: 'Plan, then execute',
  description:
    'A planner breaks a goal into a small graph of agent stages (at most maxStages, agents and models from allow-lists); the engine validates the plan, runs it after the planner, and a report summarises the results.',
  params: z
    .object({
      key: key.default('plan').describe('Key of the planner stage'),
      parentKey: key.optional().describe('Container the planner sits in'),
      reportKey: key.default('report'),
      maxStages: z.number().int().min(1).max(20).default(6),
      allowedAgentRefs: z.array(z.string().min(1).max(128)).max(20).default([]),
      allowedModels: z.array(z.string().min(1).max(200)).max(20).default([]),
      join: z.enum(['all', 'tolerate']).default('all'),
      approvePlan: z.boolean().default(false).describe('A person reviews the plan before it runs'),
      planPrompt: z
        .string()
        .min(1)
        .default(
          'Goal: {{variables.goal}}\nPlan how to reach it as a few independent or ordered steps. Each step is a stage run by its own agent in this workspace: give it a short key, a name and a precise, self-contained prompt; mark read-only steps readOnly. Add an edge from a step to every step that needs its result; steps without edges between them run in parallel.',
        ),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Plan',
        kind: 'agent',
        ...parent(v),
        prompts: [{ label: 'plan', text: v.planPrompt }],
        expands: { maxStages: v.maxStages, allowedAgentRefs: v.allowedAgentRefs, allowedModels: v.allowedModels, join: v.join },
        ...(v.approvePlan ? { approval: { prompt: 'Review the plan before its stages run.' } } : {}),
      },
      {
        key: v.reportKey,
        name: 'Report',
        kind: 'agent',
        ...parent(v),
        session: { permissionMode: 'plan' },
        prompts: [
          {
            label: 'report',
            text: `Goal: {{variables.goal}}\nThe planned stages ran. Report what was done, what failed and what is left, per stage:\n{{ stages.${v.key}.expansion.results | json }}`,
          },
        ],
      },
    ],
    edges: [{ from: v.key, to: v.reportKey }],
  }),
});

// ── Wait presets (P05 §4.3) ──────────────────────────────────────

// W1: a person approves the release and picks the environment; a timeout escalates.
export const approvalGatedRelease = define({
  name: 'approvalGatedRelease',
  title: 'Approval-gated release',
  description: 'Prepare a release, wait for a person to approve it and pick the environment (a form); deploy on approval, escalate when nobody answers in time.',
  params: z
    .object({
      prepareKey: key.default('prepare'),
      key: key.default('approve').describe('Key of the approval wait'),
      deployKey: key.default('deploy'),
      escalateKey: key.default('escalate'),
      timeoutMs: z.number().int().min(1000).max(2_592_000_000).default(86_400_000),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.prepareKey,
        name: 'Prepare release',
        kind: 'agent',
        prompts: [{ label: 'prepare', text: 'Prepare release {{variables.version}}: build it, write the release notes and summarise the risk.' }],
      },
      {
        key: v.key,
        name: 'Approve release',
        kind: 'wait',
        wait: {
          type: 'approval',
          prompt: { label: 'Release?', text: `Approve release {{variables.version}}?\n{{stages.${v.prepareKey}.summary}}` },
          form: {
            type: 'object',
            required: ['environment'],
            properties: { environment: { enum: ['staging', 'prod'] }, notes: { type: 'string' } },
          },
          timeoutMs: v.timeoutMs,
          onTimeout: 'complete',
        },
      },
      {
        key: v.deployKey,
        name: 'Deploy',
        kind: 'agent',
        prompts: [
          {
            label: 'deploy',
            text: `Deploy release {{variables.version}} to {{stages.${v.key}.output.data.environment}}. Approver notes: {{stages.${v.key}.output.data.notes}}`,
          },
        ],
      },
      {
        key: v.escalateKey,
        name: 'Escalate',
        kind: 'agent',
        prompts: [{ label: 'escalate', text: 'Nobody approved release {{variables.version}} in time. Write an escalation note for the release owner.' }],
      },
    ],
    edges: [
      { from: v.prepareKey, to: v.key },
      { from: v.key, to: v.deployKey, when: `stages.${v.key}.output.outcome == 'approved'` },
      { from: v.key, to: v.escalateKey, on: 'completion', when: `stages.${v.key}.output.outcome == 'timeout'` },
    ],
  }),
});

// W2: push, wait for CI to report on that commit (its callback URL or deliver_event), deploy.
export const ciGatedDeploy = define({
  name: 'ciGatedDeploy',
  title: 'CI-gated deploy',
  description: 'Push a change, hand CI the wait’s callback URL, wait for the CI result of that commit (CI posts to the URL), then deploy.',
  params: z
    .object({
      pushKey: key.default('push'),
      key: key.default('wait_ci').describe('Key of the event wait'),
      // The callback URL exists once the wait waits: a stage beside it (not before it) hands it to CI.
      notifyKey: key.default('notify_ci').describe('Key of the stage that hands CI the callback URL'),
      deployKey: key.default('deploy'),
      timeoutMs: z.number().int().min(1000).max(2_592_000_000).default(3_600_000),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.pushKey,
        name: 'Push',
        kind: 'agent',
        prompts: [{ label: 'push', text: 'Commit and push the change for {{variables.change}}. Report the pushed commit sha.' }],
        output: { format: 'json', schema: { type: 'object', required: ['sha'], properties: { sha: { type: 'string' } } } },
      },
      {
        key: v.key,
        name: 'Wait for CI',
        kind: 'wait',
        wait: { type: 'event', eventKey: `concat('ci:', stages.${v.pushKey}.output.sha)`, timeoutMs: v.timeoutMs, onTimeout: 'fail' },
      },
      {
        key: v.notifyKey,
        name: 'Hand CI the callback',
        kind: 'agent',
        prompts: [
          {
            label: 'notify',
            text:
              `Give the CI run of commit {{stages.${v.pushKey}.output.sha}} this callback URL, the way this project's CI takes one (a pipeline variable, a status webhook, a comment): {{stages.${v.key}.callbackUrl}}\n` +
              'CI must POST {"data": {...its result...}} to it when the build finishes. Do not post to it yourself.',
          },
        ],
      },
      {
        key: v.deployKey,
        name: 'Deploy',
        kind: 'agent',
        prompts: [{ label: 'deploy', text: `CI reported on {{stages.${v.pushKey}.output.sha}}:\n{{stages.${v.key}.output.data | json}}\nDeploy it if the build passed; otherwise explain why not.` }],
      },
    ],
    edges: [
      { from: v.pushKey, to: v.key },
      { from: v.pushKey, to: v.notifyKey },
      { from: v.key, to: v.deployKey },
    ],
  }),
});

// W3: a timer between a deploy and its verification.
export const cooldownThenVerify = define({
  name: 'cooldownThenVerify',
  title: 'Cool down, then verify',
  description: 'Deploy, wait a fixed time for metrics to settle, then verify the deployment.',
  params: z
    .object({
      deployKey: key.default('deploy'),
      key: key.default('cooldown').describe('Key of the timer wait'),
      verifyKey: key.default('verify'),
      durationMs: z.number().int().min(1000).max(2_592_000_000).default(600_000),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.deployKey,
        name: 'Deploy',
        kind: 'agent',
        prompts: [{ label: 'deploy', text: 'Deploy {{variables.service}} and report what changed.' }],
      },
      { key: v.key, name: 'Cool down', kind: 'wait', wait: { type: 'timer', durationMs: v.durationMs } },
      {
        key: v.verifyKey,
        name: 'Verify',
        kind: 'agent',
        prompts: [{ label: 'verify', text: `Verify {{variables.service}} after the deploy: check its health, error rate and logs.\nDeploy report: {{stages.${v.deployKey}.summary}}` }],
      },
    ],
    edges: [
      { from: v.deployKey, to: v.key },
      { from: v.key, to: v.verifyKey },
    ],
  }),
});

// ── Sub-workflow presets (P05 §4.2) ──────────────────────────────

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    findings: { type: 'array', items: { type: 'object', required: ['severity', 'body'], properties: { severity: { enum: ['critical', 'high', 'medium', 'low'] }, body: { type: 'string' } } } },
  },
};

// The child of S1: a security review with a declared `verdict` output.
export const securityReview = define({
  name: 'securityReview',
  title: 'Security review',
  description: 'Review a target for security problems and return a pass/fail verdict (the workflow output `verdict`).',
  params: z.object({ key: key.default('review') }).strict(),
  make: (v) => ({
    stages: [
      {
        key: v.key,
        name: 'Security review',
        kind: 'agent',
        session: { permissionMode: 'plan' },
        prompts: [
          {
            label: 'review',
            text: 'Review {{variables.target}} for security problems (injection, secrets, authorization, unsafe dependencies). Verdict fail when anything critical or high is found.',
          },
        ],
        output: { format: 'json', schema: VERDICT_SCHEMA },
      },
    ],
    edges: [],
  }),
});

// S1: build, run the published "security-review" workflow on the artifact, release on pass.
export const releaseWithSecurityReview = define({
  name: 'releaseWithSecurityReview',
  title: 'Release with a security review',
  description: 'Build, run the security-review workflow on the artifact as a sub-workflow, and release only when its verdict is pass.',
  params: z
    .object({
      buildKey: key.default('build'),
      key: key.default('security').describe('Key of the sub-workflow stage'),
      releaseKey: key.default('release'),
      childName: z.string().min(1).default('Security review').describe('Name of the published child workflow'),
    })
    .strict(),
  make: (v) => ({
    stages: [
      {
        key: v.buildKey,
        name: 'Build',
        kind: 'agent',
        prompts: [{ label: 'build', text: 'Build release {{variables.version}} and report the path of the built artifact.' }],
        output: { format: 'json', schema: { type: 'object', required: ['artifactPath'], properties: { artifactPath: { type: 'string' } } } },
      },
      {
        key: v.key,
        name: 'Security review',
        kind: 'subworkflow',
        subworkflow: { workflowRef: { name: v.childName }, inputs: { target: `stages.${v.buildKey}.output.artifactPath` }, workspace: 'isolated' },
      },
      {
        key: v.releaseKey,
        name: 'Release',
        kind: 'agent',
        prompts: [{ label: 'release', text: 'Publish release {{variables.version}}; the security review passed.' }],
      },
    ],
    edges: [
      { from: v.buildKey, to: v.key },
      { from: v.key, to: v.releaseKey, when: `stages.${v.key}.output.verdict == 'pass'` },
    ],
  }),
});

/** Every preset, by export name. */
export const PRESETS = {
  fixReviewLoop,
  testUntilGreen,
  goalLoop,
  refineUntilScore,
  researchUntilDry,
  completenessCritic,
  perFileMigration,
  migrateUntilClean,
  multiSourceResearch,
  adversarialVerify,
  judgePanel,
  planThenExecute,
  approvalGatedRelease,
  ciGatedDeploy,
  cooldownThenVerify,
  securityReview,
  releaseWithSecurityReview,
} as const;

// ── Templates generated from the presets ─────────────────────────

interface TemplateSource {
  id: string;
  category: (typeof TEMPLATE_CATEGORIES)[number];
  name: string;
  description: string;
  variables: Array<Partial<VariableDefinition> & Pick<VariableDefinition, 'name' | 'type' | 'label'>>;
  fragment: PresetFragment;
  /**
   * Stages around the fragment: they connect to its top-level container
   * (the loop or map), else to its first and last top-level stages.
   */
  before?: StageInput[];
  after?: StageInput[];
  lifecycle?: Record<string, unknown>;
  /** Catalog tags (default: the kinds the template shows off). */
  tags: string[];
  /** Declared workflow outputs (a sub-workflow's child). */
  outputs?: Record<string, string>;
}

function graphOf(t: TemplateSource): WorkflowGraphInput {
  const top = t.fragment.stages.filter((s) => !('parentKey' in s && s.parentKey));
  const container = top.find((s) => s.kind === 'loop' || s.kind === 'map');
  const edges: EdgeInput[] = [...t.fragment.edges];
  for (const s of t.before ?? []) edges.push({ from: s.key, to: (container ?? top[0]!).key });
  for (const s of t.after ?? []) edges.push({ from: (container ?? top[top.length - 1]!).key, to: s.key });
  return {
    formatVersion: WORKFLOW_FORMAT_VERSION,
    workflow: {
      name: t.name,
      description: t.description,
      variables: t.variables.map((v) => ({ required: true, ...v })) as VariableDefinition[],
      tags: t.tags,
      ...(t.lifecycle ? { lifecycle: t.lifecycle } : {}),
      ...(t.outputs ? { outputs: t.outputs } : {}),
    },
    stages: [...(t.before ?? []), ...t.fragment.stages, ...(t.after ?? [])] as WorkflowGraphInput['stages'],
    edges: edges as WorkflowGraphInput['edges'],
  };
}

const TEMPLATE_SOURCES: TemplateSource[] = [
  {
    id: 'fix-review-loop',
    tags: ['loop'],
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
    tags: ['loop'],
    category: 'testing',
    name: 'Test until green',
    description: 'Fix and re-run the test suite until it passes; exhausts when the number of failing tests stops decreasing.',
    variables: [],
    fragment: testUntilGreen.build(),
  },
  {
    id: 'goal-loop',
    tags: ['loop'],
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
    tags: ['loop'],
    category: 'documentation',
    name: 'Refine until it scores',
    description: 'Draft, critique and improve until the critic scores it 8 or more; keeps the best iteration when it runs out.',
    variables: [{ name: 'version', type: 'string', label: 'Version' }],
    fragment: refineUntilScore.build(),
  },
  {
    id: 'research-until-dry',
    tags: ['loop'],
    category: 'custom',
    name: 'Research until dry',
    description: 'Collect sources on a topic round after round until two rounds find nothing new.',
    variables: [{ name: 'topic', type: 'text', label: 'Topic' }],
    fragment: researchUntilDry.build(),
  },
  {
    id: 'completeness-critic',
    tags: ['loop'],
    category: 'custom',
    name: 'Completeness critic',
    description: 'Work on a task until a fresh critic finds nothing missing.',
    variables: [{ name: 'task', type: 'text', label: 'Task' }],
    fragment: completenessCritic.build(),
  },
  {
    id: 'per-file-migration',
    category: 'refactoring',
    name: 'Per-file migration',
    description: 'Scan for the files a change touches, then migrate each file in its own worktree and open one pull request per file.',
    tags: ['map'],
    variables: [{ name: 'change', type: 'text', label: 'The change to apply' }],
    lifecycle: { requiresCodebase: true, postProcessing: { autoPush: true, autoCreatePR: true } },
    fragment: perFileMigration.build(),
  },
  {
    id: 'migrate-until-clean',
    category: 'refactoring',
    name: 'Migrate until clean',
    description: 'Plan, migrate the files in parallel (a worktree per file, merged back), typecheck; repeat until the typecheck passes.',
    tags: ['loop', 'map'],
    variables: [],
    lifecycle: { requiresCodebase: true },
    fragment: migrateUntilClean.build(),
  },
  {
    id: 'multi-source-research',
    category: 'custom',
    name: 'Multi-source research',
    description: 'Research a topic in several sources in parallel (read-only), then synthesize what they say.',
    tags: ['map'],
    variables: [
      { name: 'topic', type: 'text', label: 'Topic' },
      { name: 'sources', type: 'list', label: 'Sources (URLs or documents)' },
    ],
    fragment: multiSourceResearch.build(),
  },
  {
    id: 'adversarial-verify',
    category: 'code-review',
    name: 'Adversarial verification',
    description: 'Audit a target, then verify every finding independently from three angles; a finding is confirmed when two of three agree.',
    tags: ['map'],
    variables: [{ name: 'target', type: 'string', label: 'What to audit' }],
    fragment: adversarialVerify.build(),
    after: [
      {
        key: 'report',
        name: 'Report',
        kind: 'agent',
        prompts: [
          {
            label: 'report',
            text: 'Write the audit report for {{variables.target}}. Confirmed findings:\n{{ map(filter(stages.verify_findings.output.results, r => r.confirmed), r => r.item) | json }}\nList the rejected ones separately, in one line each.',
          },
        ],
      },
    ],
  },
  {
    id: 'judge-panel',
    category: 'code-generation',
    name: 'Judge panel (best of N)',
    description: 'Three agents solve a task from different angles in their own worktrees; a read-only judge scores them, and only the winner is merged into the run mount.',
    tags: ['map', 'judge-panel'],
    variables: [{ name: 'task', type: 'text', label: 'Task' }],
    lifecycle: { requiresCodebase: true },
    fragment: judgePanel.build(),
  },
  {
    id: 'plan-then-execute',
    category: 'code-generation',
    name: 'Plan, then execute',
    description: 'A planner breaks a goal into up to six agent stages; the engine validates the plan and runs it, then a report summarises what each stage did.',
    tags: ['plan-then-execute'],
    variables: [{ name: 'goal', type: 'text', label: 'Goal' }],
    fragment: planThenExecute.build(),
  },
  {
    id: 'approval-gated-release',
    category: 'deployment',
    name: 'Approval-gated release',
    description: 'Prepare a release, wait for an approval that picks the environment, deploy; escalate when nobody answers in time.',
    tags: ['wait'],
    variables: [{ name: 'version', type: 'string', label: 'Version' }],
    fragment: approvalGatedRelease.build(),
  },
  {
    id: 'ci-gated-deploy',
    category: 'deployment',
    name: 'CI-gated deploy',
    description: 'Push a change, wait for CI to report on the commit (its callback URL), then deploy.',
    tags: ['wait'],
    variables: [{ name: 'change', type: 'text', label: 'The change' }],
    fragment: ciGatedDeploy.build(),
  },
  {
    id: 'cooldown-then-verify',
    category: 'deployment',
    name: 'Cool down, then verify',
    description: 'Deploy, wait ten minutes for metrics to settle, then verify the deployment.',
    tags: ['wait'],
    variables: [{ name: 'service', type: 'string', label: 'Service' }],
    fragment: cooldownThenVerify.build(),
  },
  {
    id: 'security-review',
    category: 'code-review',
    name: 'Security review',
    description: 'Review a target for security problems; the workflow output `verdict` is pass or fail. Publish it to use it as a sub-workflow.',
    tags: ['subworkflow-child'],
    variables: [{ name: 'target', type: 'string', label: 'What to review' }],
    outputs: { verdict: 'stages.review.output.verdict', findings: 'stages.review.output.findings' },
    fragment: securityReview.build(),
  },
  {
    id: 'release-with-security-review',
    category: 'deployment',
    name: 'Release with a security review',
    description: 'Build, run the published Security review workflow on the artifact as a sub-workflow, release on a pass.',
    tags: ['subworkflow'],
    variables: [{ name: 'version', type: 'string', label: 'Version' }],
    fragment: releaseWithSecurityReview.build(),
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

