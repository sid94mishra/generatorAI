// ────────────────────────────────────────────────────────────────
// Code Review Pipeline — Example Workflow Script
//
// A script is an authoring-time builder: its default export is a
// `workflow()` builder from `@generatorai/workflow-spec/builders`, which
// the loader builds and validates into a v2 WorkflowGraph. It shows:
//   - A multi-stage DAG with parallel branches and a fan-in
//   - User-configurable variables
//   - Inline hook functions
//   - Run profiles (stage overrides by stage key)
//   - Session configuration
// ────────────────────────────────────────────────────────────────

import { workflow } from '@generatorai/workflow-spec/builders';

export default workflow('Code Review Pipeline')
  .description('Multi-stage code review with security analysis and parallel performance check')
  .tags(['code-review', 'security', 'scripted'])

  // ── User Input Variables ──
  .variable('repository', {
    type: 'string',
    label: 'Repository URL',
    required: true,
    description: 'The git repository to review',
  })
  .variable('branch', {
    type: 'string',
    label: 'Branch',
    required: true,
    defaultValue: 'main',
  })
  .variable('depth', {
    type: 'choice',
    label: 'Review Depth',
    options: ['surface', 'thorough', 'comprehensive'],
    required: true,
    defaultValue: 'thorough',
  })
  .variable('focusAreas', {
    type: 'text',
    label: 'Focus Areas',
    required: false,
    description: 'Specific areas to focus the review on',
  })

  // ── Session ──
  .session({
    model: 'gpt-4.1',
    systemPromptAppend: 'You are an expert code reviewer. Be concise and actionable.',
  })

  // ── Stages ──
  .stage('analyze', (s) =>
    s
      .name('Static Analysis')
      .description('Run static analysis and gather codebase metrics')
      .prompt(
        `Analyze the codebase at {{repository}} on branch {{branch}}.
Focus areas: {{focusAreas}}

Provide:
1. Code structure overview
2. Dependency analysis
3. Potential issue areas
4. Complexity metrics`,
      )
      .timeouts({ attemptMs: 120_000 })
      .output({ format: 'json' })
      .hook('pre_prompt', async () => ({ proceed: true, message: 'Starting static analysis...' })),
  )

  .stage('security', (s) =>
    s
      .name('Security Scan')
      .description('Deep security analysis of identified issues')
      .prompt(
        `Based on the static analysis results, perform a detailed security review.
Depth level: {{depth}}

Check for:
- SQL injection vulnerabilities
- XSS vectors
- Authentication bypasses
- Dependency vulnerabilities
- Secrets in code`,
      )
      .contextFrom(['analyze'])
      .retry({ maxAttempts: 3, initialDelayMs: 5000, backoffMultiplier: 2 })
      .timeouts({ attemptMs: 180_000 }),
  )

  .stage('performance', (s) =>
    s
      .name('Performance Review')
      .description('Identify performance bottlenecks')
      .prompt(
        `Review the codebase for performance issues.
Focus on hot paths, N+1 queries, memory leaks, and unnecessary allocations.`,
      )
      .contextFrom(['analyze'])
      .timeouts({ attemptMs: 90_000 }),
  )

  .stage('report', (s) =>
    s
      .name('Consolidated Report')
      .description('Compile all findings into a structured report')
      .prompt(
        `Compile findings from all previous stages into a comprehensive code review report.
Include severity ratings, actionable recommendations, and priority ordering.
Format as a markdown document suitable for a PR comment.`,
      )
      .contextFrom(['analyze', 'security', 'performance'], 'structured'),
  )

  // ── Edges: security and performance run in parallel; report waits for both ──
  .edge('analyze', 'security')
  .edge('analyze', 'performance')
  .edge('security', 'report', { on: 'completion' })
  .edge('performance', 'report', { on: 'completion' })

  // ── Workflow-level inline hooks ──
  .hook('on_run_start', async () => ({ proceed: true, message: `Review started at ${new Date().toISOString()}` }))
  .hook('on_run_complete', async () => ({ proceed: true }));

// ── Run Profiles ──
export const profiles = [
  {
    name: 'Quick Surface Review',
    description: 'Fast review skipping the security scan',
    variables: { depth: 'surface', branch: 'main' },
    permissionMode: 'bypassPermissions',
    stageOverrides: [{ stageKey: 'security', skip: true }],
  },
  {
    name: 'Full Security Audit',
    description: 'Comprehensive security-focused review',
    variables: { depth: 'comprehensive' },
    permissionMode: 'bypassPermissions',
  },
  {
    name: 'CI Pipeline Review',
    description: 'Automated review for CI/CD integration',
    variables: { depth: 'thorough' },
    permissionMode: 'bypassPermissions',
  },
];
