// ────────────────────────────────────────────────────────────────
// Code Review Pipeline — Example Workflow Script
//
// This demonstrates the WorkflowBuilder API for programmatic
// workflow definition, including:
//   - Multi-stage DAG with parallel execution
//   - User-configurable variables
//   - Inline hook functions
//   - Run profiles for different configurations
//   - Harness configuration
// ────────────────────────────────────────────────────────────────

import { WorkflowBuilder } from '@generatorai/shared';

const workflow = new WorkflowBuilder('code-review-pipeline')
  .name('Code Review Pipeline')
  .description('Multi-stage code review with security analysis and parallel performance check')
  .sessionMode('per-stage')
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

  // ── Harness Configuration ──
  .model('gpt-4.1')
  .systemPromptAppend('You are an expert code reviewer. Be concise and actionable.')

  // ── Stage Definitions ──
  .stage('analyze', stage => stage
    .name('Static Analysis')
    .description('Run static analysis and gather codebase metrics')
    .prompt(`
Analyze the codebase at {{repository}} on branch {{branch}}.
Focus areas: {{focusAreas}}

Provide:
1. Code structure overview
2. Dependency analysis
3. Potential issue areas
4. Complexity metrics
    `.trim())
    .timeout(120_000)
    .outputFormat('json')
    .hook('pre_prompt', {
      type: 'script',
      command: 'echo',
      args: ['Starting static analysis...'],
      failurePolicy: 'skip',
    })
  )

  .stage('security', stage => stage
    .name('Security Scan')
    .description('Deep security analysis of identified issues')
    .prompt(`
Based on the static analysis results, perform a detailed security review.
Depth level: {{depth}}

Check for:
- SQL injection vulnerabilities
- XSS vectors
- Authentication bypasses
- Dependency vulnerabilities
- Secrets in code
    `.trim())
    .contextFrom(['analyze'])
    .retryPolicy({ maxRetries: 2, backoffMs: 5000, backoffMultiplier: 2 })
    .timeout(180_000)
  )

  .stage('performance', stage => stage
    .name('Performance Review')
    .description('Identify performance bottlenecks')
    .prompt(`
Review the codebase for performance issues.
Focus on hot paths, N+1 queries, memory leaks, and unnecessary allocations.
    `.trim())
    .contextFrom(['analyze'])
    .timeout(90_000)
  )

  .stage('report', stage => stage
    .name('Consolidated Report')
    .description('Compile all findings into a structured report')
    .prompt(`
Compile findings from all previous stages into a comprehensive code review report.
Include severity ratings, actionable recommendations, and priority ordering.
Format as a markdown document suitable for a PR comment.
    `.trim())
    .contextFilter('structured')
    .contextFrom(['analyze', 'security', 'performance'])
  )

  // ── DAG Edges ──
  .edge('analyze', 'security', 'on_success')
  .edge('analyze', 'performance', 'on_success')   // Parallel: security + performance
  .edge('security', 'report', 'on_completion')
  .edge('performance', 'report', 'on_completion') // Fan-in: report waits for both

  // ── Workflow-Level Inline Hooks ──
  .onRunStart(async (ctx) => {
    return { variables: { reviewStartedAt: new Date().toISOString() } };
  })
  .onRunComplete(async (ctx) => {
    // Post-completion hook - could send webhooks, notifications, etc.
    return {};
  })

  // ── Build ──
  .build();

// ── Run Profiles ──
const profiles = [
  {
    version: 1,
    name: 'Quick Surface Review',
    description: 'Fast review skipping security scan',
    variables: { depth: 'surface', branch: 'main' },
    permissionMode: 'bypassPermissions',
    stageOverrides: [
      { stageName: 'security', skip: true },
    ],
  },
  {
    version: 1,
    name: 'Full Security Audit',
    description: 'Comprehensive security-focused review',
    variables: { depth: 'comprehensive' },
    permissionMode: 'bypassPermissions',
    sessionMode: 'per-stage',
  },
  {
    version: 1,
    name: 'CI Pipeline Review',
    description: 'Automated review for CI/CD integration',
    variables: { depth: 'thorough' },
    permissionMode: 'bypassPermissions',
    sessionMode: 'auto',
  },
];

export { workflow, profiles };
