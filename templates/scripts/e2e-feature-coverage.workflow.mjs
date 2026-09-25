// ────────────────────────────────────────────────────────────────
// e2e-feature-coverage.workflow.mjs
//
// A workflow script for end-to-end testing of the script subsystem:
//
//   - The `workflow()` builder from `@generatorai/workflow-spec/builders`
//   - All 5 variable types (string, number, boolean, choice, text)
//   - Variable templating in prompts ({{variable}})
//   - A diamond DAG with parallel branches and a fan-in
//   - success and completion edges
//   - A stage guard (`variables.enable_tests`)
//   - context modes (output / summary / none) and context.from
//   - JSON output with a schema
//   - Result validation rules (contains / regex / min_length)
//   - Retry with backoff and per-stage attempt timeouts
//   - Per-stage session overrides (model + reasoning effort)
//   - Inline workflow and stage hooks (JS functions)
//   - Three run profiles: variable overrides, permissionMode, and
//     stage overrides (skip, variables) by stage key
// ────────────────────────────────────────────────────────────────

import { workflow } from '@generatorai/workflow-spec/builders';

export default workflow('E2E Feature Coverage Workflow')
  .description(
    'Diamond DAG exercising every script feature: variables, hooks, profiles, ' +
      'validation, retry, edge types, and parallel execution.',
  )
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

  // ── Session defaults (overridable per stage) ──
  .session({
    model: 'claude-sonnet-4.6',
    systemPromptAppend:
      'You are an expert assistant. Be concise, actionable, and follow the output contract in every stage exactly.',
  })

  // ── Workflow-level inline hooks ──
  .hook('on_run_start', async (ctx) => ({ proceed: true, message: `Run ${ctx.runId} started` }))
  .hook('on_run_complete', async (ctx) => ({
    proceed: true,
    message: `Run ${ctx.runId} complete; vars=${Object.keys(ctx.variables ?? {}).join(',')}`,
  }))

  // ── Stage: classify (root) — JSON output with a schema, no context ──
  .stage('classify', (s) =>
    s
      .name('Classify Topic')
      .description('Produces a JSON classification of the topic for downstream stages.')
      .prompt(
        `Classify the topic "{{topic}}" with depth={{depth}} and max_findings={{max_findings}}.\n\n` +
          `Return ONLY a JSON object with the shape:\n` +
          `{ "category": string, "keywords": string[], "confidence": number }\n\n` +
          `Begin your reply with the literal token CLASSIFY_OK on the first line, ` +
          `then the JSON block.`,
      )
      .context({ mode: 'none' })
      .output({
        format: 'json',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number' },
          },
          required: ['category', 'keywords', 'confidence'],
        },
      })
      .timeouts({ attemptMs: 120_000 })
      .session({ model: 'claude-sonnet-4.6' }),
  )

  // ── Stage: summarize (Branch A) — summary context, rules, retry ──
  .stage('summarize', (s) =>
    s
      .name('Branch A — Summarize')
      .description('Produces a 2-sentence summary using only the classify summary.')
      .prompt(
        `Using the classification above, write a SUMMARY of "{{topic}}".\n\n` +
          `Requirements:\n` +
          `- Exactly 2 sentences\n` +
          `- Begin with the literal token SUMMARY_OK on its own first line\n` +
          `- Then a blank line, then the 2-sentence summary`,
      )
      .contextFrom(['classify'], 'summary')
      .rule({ type: 'contains', value: 'SUMMARY_OK', message: 'starts with SUMMARY_OK' })
      .rule({ type: 'regex', pattern: 'SUMMARY_OK\\s', message: 'token on its own line' })
      .rule({ type: 'min_length', value: 40, message: 'has a summary' })
      .timeouts({ attemptMs: 120_000 })
      .retry({ maxAttempts: 2, initialDelayMs: 1000, backoffMultiplier: 2 })
      .hook('pre_run', async (ctx) => ({ proceed: true, message: `summarize pre_run for ${ctx.runId}` })),
  )

  // ── Stage: keywords (Branch B) — guarded, fresh context ──
  .stage('keywords', (s) =>
    s
      .name('Branch B — Keywords')
      .description('Guarded — only runs when enable_tests is true.')
      .guard('variables.enable_tests')
      .prompt(
        `List exactly {{max_findings}} keywords for "{{topic}}".\n\n` +
          `Begin with the literal token KEYWORDS_OK on its own first line, then ` +
          `the comma-separated keyword list.`,
      )
      .context({ mode: 'none' })
      .timeouts({ attemptMs: 120_000 })
      .session({ reasoningEffort: 'low' }),
  )

  // ── Stage: synthesize (fan-in) — full output context from both branches ──
  .stage('synthesize', (s) =>
    s
      .name('Final Synthesis')
      .description('Combines outputs from both branches into a final report.')
      .prompt(
        `Synthesize a final FINAL_DONE report on "{{topic}}" using the summary ` +
          `and keyword outputs from the previous stages. ` +
          `Notes from operator: "{{notes}}".\n\n` +
          `Begin with the literal token FINAL_DONE on its own first line.`,
      )
      .contextFrom(['summarize', 'keywords'], 'output')
      .timeouts({ attemptMs: 180_000 })
      .hook('post_run', async (ctx) => ({ proceed: true, message: `postSynthesize ran in run ${ctx.runId}` })),
  )

  // ── Edges ──
  // keywords → synthesize is a completion edge, so synthesize still runs
  // when Branch B is skipped by its guard.
  .edge('classify', 'summarize')
  .edge('classify', 'keywords')
  .edge('summarize', 'synthesize')
  .edge('keywords', 'synthesize', { on: 'completion' });

// ── Run profiles ──
export const profiles = [
  {
    name: 'quick-surface',
    description: 'Fast surface review, skip Branch B keywords stage.',
    variables: { topic: 'quick surface', depth: 'surface', max_findings: 3, enable_tests: false, notes: 'quick path' },
    permissionMode: 'bypassPermissions',
    stageOverrides: [{ stageKey: 'keywords', skip: true }],
  },
  {
    name: 'thorough-with-overrides',
    description: 'Thorough analysis; per-stage variables on Branch A.',
    variables: {
      topic: 'profile thorough run',
      depth: 'thorough',
      max_findings: 5,
      enable_tests: true,
      notes: 'thorough path with overrides',
    },
    permissionMode: 'bypassPermissions',
    stageOverrides: [{ stageKey: 'summarize', variables: { override_marker: 'branch-a-override' } }],
  },
  {
    name: 'comprehensive-all',
    description: 'Full diamond, no overrides — verifies defaults end-to-end.',
    variables: {
      topic: 'comprehensive default run',
      depth: 'comprehensive',
      max_findings: 7,
      enable_tests: true,
      notes: 'full default flow',
    },
    permissionMode: 'bypassPermissions',
  },
];
