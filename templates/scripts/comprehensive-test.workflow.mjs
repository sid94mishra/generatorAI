// ────────────────────────────────────────────────────────────────
// comprehensive-test.workflow.mjs — a multi-stage workflow script
// exercising the script features:
//   - 4 stages with parallel and sequential execution
//   - success and completion edges
//   - Inline stage hooks (pre/post run)
//   - Variables with defaults
//   - Multiple run profiles
//   - Per-stage model overrides
//   - A stage guard
// ────────────────────────────────────────────────────────────────

import { workflow } from '@generatorai/workflow-spec/builders';

const hookOk = (message) => async () => ({ proceed: true, message });

export default workflow('Comprehensive Test Workflow')
  .description('Tests the script features: DAG, hooks, profiles, variables, guards')
  .tags(['test', 'comprehensive', 'multi-stage'])
  .variable('target_language', {
    type: 'choice',
    label: 'Target Language',
    required: true,
    defaultValue: 'TypeScript',
    options: ['TypeScript', 'Python', 'Go', 'Rust'],
  })
  .variable('project_name', {
    type: 'string',
    label: 'Project Name',
    required: true,
    defaultValue: 'test-project',
  })
  .variable('enable_tests', {
    type: 'boolean',
    label: 'Generate Tests',
    required: false,
    defaultValue: true,
  })
  .variable('complexity_level', {
    type: 'number',
    label: 'Complexity (1-5)',
    required: false,
    defaultValue: 3,
  })

  // ── Stage 1: Planning ──
  .stage('planning', (s) =>
    s
      .name('Project Planning')
      .prompt(
        `You are a software architect. Plan a {{target_language}} project called "{{project_name}}".
Consider complexity level {{complexity_level}}/5.
Output: a structured plan with modules, dependencies, and architecture decisions.`,
      )
      .model('gpt-4o')
      .hook('pre_run', hookOk('Planning started'))
      .hook('post_run', hookOk('Planning complete, ready for parallel execution')),
  )

  // ── Stage 2: Code Generation (depends on planning) ──
  .stage('codegen', (s) =>
    s
      .name('Code Generation')
      .prompt(
        `Based on the plan from the previous stage, generate the core module code in {{target_language}}.
Project: {{project_name}}, Complexity: {{complexity_level}}/5.
Follow best practices and include proper error handling.`,
      )
      .model('gpt-4o'),
  )

  // ── Stage 3: Test Generation (parallel with codegen, guarded) ──
  .stage('testgen', (s) =>
    s
      .name('Test Generation')
      .prompt(
        `Based on the plan, generate comprehensive unit tests in {{target_language}}.
Project: {{project_name}}. Cover edge cases and error scenarios.
Use the standard testing framework for {{target_language}}.`,
      )
      .model('gpt-4o')
      .guard('variables.enable_tests'),
  )

  // ── Stage 4: Documentation (depends on both codegen and testgen) ──
  .stage('documentation', (s) =>
    s
      .name('Documentation')
      .prompt(
        `Generate comprehensive documentation for the {{target_language}} project "{{project_name}}".
Include: API reference, usage examples, architecture overview.
Reference both the implementation and tests.`,
      )
      .model('gpt-4o')
      .hook('post_run', hookOk('Documentation generated, workflow complete')),
  )

  .edge('planning', 'codegen')
  .edge('planning', 'testgen')
  .edge('codegen', 'documentation')
  // Documentation still runs when testgen is skipped.
  .edge('testgen', 'documentation', { on: 'completion' });

// ── Run Profiles ──
export const profiles = [
  {
    name: 'typescript-simple',
    description: 'TypeScript project with low complexity',
    variables: { target_language: 'TypeScript', project_name: 'simple-ts-app', enable_tests: true, complexity_level: 2 },
  },
  {
    name: 'python-complex',
    description: 'Python project with high complexity',
    variables: { target_language: 'Python', project_name: 'complex-py-service', enable_tests: true, complexity_level: 5 },
  },
  {
    name: 'go-no-tests',
    description: 'Go project without test generation',
    variables: { target_language: 'Go', project_name: 'go-microservice', enable_tests: false, complexity_level: 3 },
  },
];
