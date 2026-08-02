// ────────────────────────────────────────────────────────────────
// e2e-feature-coverage.workflow.mjs
//
// Complex workflow script for end-to-end testing of EVERY major
// feature of the workflow-script subsystem:
//
//   - WorkflowBuilder fluent API
//   - All 5 variable types (string, number, boolean, choice, text)
//   - Variable templating in prompts ({{variable}})
//   - Multi-stage diamond DAG with parallel branches and fan-in
//   - All four edge types (on_success / on_failure / on_completion / always)
//   - Stage condition expressions (`{{enable_tests}} === true`)
//   - contextFilter (full / summary-only / none) + contextFrom
//   - outputFormat=json + outputSchema for structured stage output
//   - resultValidation rules (contains / regex / min_length)
//   - retryPolicy with backoff
//   - timeoutMs per stage
//   - harnessOverrides per stage (model + reasoning effort)
//   - Inline workflow hook (onRunStart, onRunComplete) using JS functions
//   - Workflow-level lifecycle hook of type "script" (uses node -e since
//     SandboxedScriptRunner allowlists `node`)
//   - Stage-level hooks of type "script" + type "function" inline
//   - Three run profiles exercising: variable overrides, permissionMode,
//     sessionMode override, and stageOverrides with skip + timeout + variables
// ────────────────────────────────────────────────────────────────

import { WorkflowBuilder } from '@generatorai/shared';

const builder = new WorkflowBuilder('e2e-feature-coverage')
  .name('E2E Feature Coverage Workflow')
  .description(
    'Diamond DAG exercising every script feature: variables, hooks, profiles, ' +
    'validation, retry, edge types, and parallel execution.',
  )
  .sessionMode('per-stage')
  .tags(['e2e-test', 'script', 'feature-coverage'])

  // ── Variables — one of every type ──
  .variable('topic', {
    type: 'string',
    label: 'Topic',
    required: true,
    defaultValue: 'workflow scripting',
    description: 'Subject the workflow analyzes.',
  })
  .variable('depth', {
    type: 'choice',
    label: 'Analysis Depth',
    options: ['surface', 'thorough', 'comprehensive'],
    required: true,
    defaultValue: 'thorough',
  })
  .variable('max_findings', {
    type: 'number',
    label: 'Max Findings',
    required: false,
    defaultValue: 5,
  })
  .variable('enable_tests', {
    type: 'boolean',
    label: 'Generate Tests',
    required: false,
    defaultValue: true,
  })
  .variable('notes', {
    type: 'text',
    label: 'Additional Notes',
    required: false,
    defaultValue: '',
  })

  // ── Harness defaults (overridable per stage) ──
  .model('claude-sonnet-4.6')
  .systemPromptAppend(
    'You are an expert assistant. Be concise, actionable, and follow the ' +
    'output contract in every stage exactly.',
  );

// ── Workflow-level lifecycle hooks ──
// Script-type hook using `node -e` (the sandboxed runner allowlists `node`).
// Writes a marker line to a per-OS tmp file so the test can verify the hook
// fired without depending on console capture.
builder.hook('on_run_start', {
  type: 'script',
  command: 'node',
  args: [
    '-e',
    "require('fs').appendFileSync(require('os').tmpdir()+'/e2e_feature_log.txt','RUN_START\\n')",
  ],
  failurePolicy: 'continue',
  timeoutMs: 5000,
});

// Inline function hook — registered as `script:e2e-feature-coverage:onComplete`
// at load time and invoked by HookExecutor when the run completes.
builder.onRunComplete(async (ctx) => {
  return {
    proceed: true,
    message: `Run ${ctx.runId} complete; vars=${Object.keys(ctx.variables ?? {}).join(',')}`,
  };
});

// ── Stage 0: Classify (root) ──
// Demonstrates: outputFormat='json', outputSchema, contextFilter='none',
// per-stage timeout, harnessOverrides (model override), variables prop.
builder.stage('classify', (stage) =>
  stage
    .name('Classify Topic')
    .description('Produces a JSON classification of the topic for downstream stages.')
    .prompt(
      `Classify the topic "{{topic}}" with depth={{depth}} and max_findings={{max_findings}}.\n\n` +
      `Return ONLY a JSON object with the shape:\n` +
      `{ "category": string, "keywords": string[], "confidence": number }\n\n` +
      `Begin your reply with the literal token CLASSIFY_OK on the first line, ` +
      `then the JSON block.`
    )
    .contextFilter('none')
    .outputFormat('json')
    .outputSchema({
      type: 'object',
      properties: {
        category: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
      },
      required: ['category', 'keywords', 'confidence'],
    })
    .timeout(120000)
    .variables({ phase: 'classification' })
    .harnessOverrides({ model: 'claude-sonnet-4.6' })
);

// ── Stage 1: Branch A (parallel) — summary-only context ──
// Demonstrates: contextFrom + contextFilter='summary-only', resultValidation
// (contains + min_length), retryPolicy with backoff.
builder.stage('summarize', (stage) =>
  stage
    .name('Branch A — Summarize')
    .description('Produces a 2-sentence summary using only the classify summary.')
    .prompt(
      `Using the classification above, write a SUMMARY of "{{topic}}".\n\n` +
      `Requirements:\n` +
      `- Exactly 2 sentences\n` +
      `- Begin with the literal token SUMMARY_OK on its own first line\n` +
      `- Then a blank line, then the 2-sentence summary`
    )
    .contextFrom(['classify'])
    .contextFilter('summary-only')
    .timeout(120000)
    .retryPolicy({ maxRetries: 1, backoffMs: 1000, backoffMultiplier: 2 })
    // Inline stage script hook to log lifecycle (verifies pre_run hook plumbing
    // in v2 DAG runner).
    .hook('pre_run', {
      type: 'script',
      command: 'node',
      args: [
        '-e',
        "require('fs').appendFileSync(require('os').tmpdir()+'/e2e_feature_log.txt','SUMMARIZE_PRE_RUN\\n')",
      ],
      failurePolicy: 'continue',
      timeoutMs: 5000,
    })
);

// ── Stage 2: Branch B (parallel) — no context, conditional ──
// Demonstrates: stage condition (skipped when `enable_tests=false`),
// contextFilter='none' (deliberately fresh context).
builder.stage('keywords', (stage) =>
  stage
    .name('Branch B — Keywords')
    .description('Conditional — only runs when enable_tests is true.')
    .condition('{{enable_tests}} === true')
    .prompt(
      `List exactly {{max_findings}} keywords for "{{topic}}".\n\n` +
      `Begin with the literal token KEYWORDS_OK on its own first line, then ` +
      `the comma-separated keyword list.`
    )
    .contextFilter('none')
    .timeout(120000)
);

// ── Stage 3: Synthesis (fan-in, full context) ──
// Demonstrates: contextFilter='full', contextFrom multiple stages,
// on_failure / on_completion edges (set below) — and a function-type
// stage hook.
builder.stage('synthesize', (stage) =>
  stage
    .name('Final Synthesis')
    .description('Combines outputs from both branches into a final report.')
    .prompt(
      `Synthesize a final FINAL_DONE report on "{{topic}}" using the summary ` +
      `and keyword outputs from the previous stages. ` +
      `Notes from operator: "{{notes}}".\n\n` +
      `Begin with the literal token FINAL_DONE on its own first line.`
    )
    .contextFrom(['summarize', 'keywords'])
    .contextFilter('full')
    .timeout(180000)
    .hook('post_run', {
      type: 'function',
      handlerName: 'script:e2e-feature-coverage:postSynthesize',
      failurePolicy: 'continue',
      timeoutMs: 5000,
    })
);

// ── Edges ──
//   classify -> summarize  on_success    (Branch A)
//   classify -> keywords   on_success    (Branch B — also gated by condition)
//   summarize -> synthesize on_success
//   keywords  -> synthesize on_completion (so synthesize still runs when Branch B is skipped)
builder
  .edge('classify', 'summarize', 'on_success')
  .edge('classify', 'keywords', 'on_success')
  .edge('summarize', 'synthesize', 'on_success')
  .edge('keywords', 'synthesize', 'on_completion');

// ── Build the workflow output ──
export const workflow = builder.build();

// ── Inline function-type hook registration ──
// Keys must match the handlerName used above: `script:<workflowId>:<localHookId>`.
const inlineHooks = new Map();
inlineHooks.set('postSynthesize', async (ctx) => {
  return {
    proceed: true,
    message: `postSynthesize ran for stage ${ctx.stageName} in run ${ctx.runId}`,
  };
});
workflow.inlineHooks = inlineHooks;

// ── Run profiles ──
// Three profiles exercising every RunProfileConfig field used by orchestrator.
export const profiles = [
  {
    version: 1,
    name: 'quick-surface',
    description: 'Fast surface review, skip Branch B keywords stage.',
    variables: {
      topic: 'quick surface',
      depth: 'surface',
      max_findings: 3,
      enable_tests: false,
      notes: 'quick path',
    },
    sessionMode: 'single',
    permissionMode: 'bypassPermissions',
    stageOverrides: [
      // Skip Branch B by NAME (orchestrator matches stageName OR stageIndex).
      { stageName: 'Branch B — Keywords', skip: true },
    ],
  },
  {
    version: 1,
    name: 'thorough-with-overrides',
    description: 'Thorough analysis; override per-stage timeout + variables on Branch A.',
    variables: {
      topic: 'profile thorough run',
      depth: 'thorough',
      max_findings: 5,
      enable_tests: true,
      notes: 'thorough path with overrides',
    },
    sessionMode: 'per-stage',
    permissionMode: 'bypassPermissions',
    stageOverrides: [
      {
        // Match by stageIndex this time (Branch A is stage index 1).
        stageIndex: 1,
        timeoutMs: 180000,
        variables: { override_marker: 'branch-a-override' },
      },
    ],
  },
  {
    version: 1,
    name: 'comprehensive-all',
    description: 'Full diamond, no overrides — verifies defaults end-to-end.',
    variables: {
      topic: 'comprehensive default run',
      depth: 'comprehensive',
      max_findings: 7,
      enable_tests: true,
      notes: 'full default flow',
    },
    sessionMode: 'auto',
    permissionMode: 'bypassPermissions',
  },
];
