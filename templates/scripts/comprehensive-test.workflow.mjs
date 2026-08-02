// ────────────────────────────────────────────────────────────────
// comprehensive-test.workflow.mjs — Multi-stage workflow script
// for testing ALL PWS features:
//   - 4 stages with parallel + sequential execution
//   - All edge types (on_success, on_failure, always)
//   - Inline hooks (pre/post stage)
//   - Variables with defaults
//   - Multiple run profiles
//   - Skills and model overrides
//   - Conditions on stages
// ────────────────────────────────────────────────────────────────

import { WorkflowBuilder } from '@generatorai/shared';

const builder = new WorkflowBuilder('comprehensive-test')
  .name('Comprehensive Test Workflow')
  .description('Tests all PWS features: DAG, hooks, profiles, variables, conditions')
  .sessionMode('per-stage')
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
  });

// ── Stage 1: Planning ──
builder
  .stage('planning', stage => stage
    .name('Project Planning')
    .prompt(`You are a software architect. Plan a {{target_language}} project called "{{project_name}}".
Consider complexity level {{complexity_level}}/5.
Output: a structured plan with modules, dependencies, and architecture decisions.`)
    .harnessOverrides({ model: 'gpt-4o' })
    .variables({ phase: 'planning' })
    .hook('pre_execution', {
      type: 'function',
      handlerName: 'script:comprehensive-test:prePlanningHook',
      failurePolicy: 'continue',
    })
    .hook('post_execution', {
      type: 'function',
      handlerName: 'script:comprehensive-test:postPlanningHook',
      failurePolicy: 'continue',
    })
  )

  // ── Stage 2: Code Generation (depends on planning) ──
  .stage('codegen', stage => stage
    .name('Code Generation')
    .prompt(`Based on the plan from the previous stage, generate the core module code in {{target_language}}.
Project: {{project_name}}, Complexity: {{complexity_level}}/5.
Follow best practices and include proper error handling.`)
    .harnessOverrides({ model: 'gpt-4o' })
    .variables({ phase: 'implementation' })
  )

  // ── Stage 3: Test Generation (parallel with codegen, depends on planning) ──
  .stage('testgen', stage => stage
    .name('Test Generation')
    .prompt(`Based on the plan, generate comprehensive unit tests in {{target_language}}.
Project: {{project_name}}. Cover edge cases and error scenarios.
Use the standard testing framework for {{target_language}}.`)
    .harnessOverrides({ model: 'gpt-4o' })
    .condition('{{enable_tests}} === true')
    .variables({ phase: 'testing' })
  )

  // ── Stage 4: Documentation (depends on both codegen and testgen) ──
  .stage('documentation', stage => stage
    .name('Documentation')
    .prompt(`Generate comprehensive documentation for the {{target_language}} project "{{project_name}}".
Include: API reference, usage examples, architecture overview.
Reference both the implementation and tests.`)
    .harnessOverrides({ model: 'gpt-4o' })
    .variables({ phase: 'documentation' })
    .hook('post_execution', {
      type: 'function',
      handlerName: 'script:comprehensive-test:postDocsHook',
      failurePolicy: 'continue',
    })
  )

  // ── Edges: planning → codegen, planning → testgen, codegen → docs, testgen → docs ──
  .edge('planning', 'codegen', 'on_success')
  .edge('planning', 'testgen', 'on_success')
  .edge('codegen', 'documentation', 'on_success')
  .edge('testgen', 'documentation', 'on_completion'); // docs runs even if tests skipped

export const workflow = builder.build();

// ── Inline Hook Handlers ──
const inlineHooks = new Map();
inlineHooks.set('prePlanningHook', async (context) => {
  return { proceed: true, message: `Planning started for ${context.variables?.project_name ?? 'unknown'}` };
});
inlineHooks.set('postPlanningHook', async (context) => {
  return { proceed: true, message: 'Planning complete, ready for parallel execution' };
});
inlineHooks.set('postDocsHook', async (context) => {
  return { proceed: true, message: 'Documentation generated, workflow complete' };
});

// Attach inline hooks to workflow output
workflow.inlineHooks = inlineHooks;

// ── Run Profiles ──
export const profiles = [
  {
    version: 1,
    name: 'typescript-simple',
    description: 'TypeScript project with low complexity',
    variables: {
      target_language: 'TypeScript',
      project_name: 'simple-ts-app',
      enable_tests: true,
      complexity_level: 2,
    },
    sessionMode: 'per-stage',
  },
  {
    version: 1,
    name: 'python-complex',
    description: 'Python project with high complexity',
    variables: {
      target_language: 'Python',
      project_name: 'complex-py-service',
      enable_tests: true,
      complexity_level: 5,
    },
    sessionMode: 'per-stage',
  },
  {
    version: 1,
    name: 'go-no-tests',
    description: 'Go project without test generation',
    variables: {
      target_language: 'Go',
      project_name: 'go-microservice',
      enable_tests: false,
      complexity_level: 3,
    },
    sessionMode: 'single',
  },
];
