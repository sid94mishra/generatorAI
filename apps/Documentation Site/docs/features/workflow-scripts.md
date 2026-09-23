---
description: Discover, materialize, and execute code-first workflow definitions and run profiles.
---
# Workflow scripts

Workflow scripts are `.workflow.mjs` files that produce reusable workflow definitions through `WorkflowBuilder` and `StageBuilder`. They complement the visual builder when definitions benefit from code review, repeated patterns, or programmatic construction.

## Use the script catalog

1. Open **Scripts** and choose a discovered script.
2. Read its description, tags, stages, and edges.
3. Choose an optional **Run Profile**.
4. Select **Run Script** to create a definition/run and open the run screen, or **Materialize** to create a saved definition for inspection and editing.

The profile selection applies to the next run. The current materialize action does not pass the selected profile from the web page. Materializing a definition is not the same as executing its stages.

The web catalog is a browse/run/materialize interface. It does not contain a full source-code editor or an upload button for every script administration API. Source files, configured discovery paths, and server administration routes are separate ways to manage the catalog.

## Minimal two-stage definition

The following follows the repository's builder/export convention. Use it in a configured script environment where `@generatorai/shared` resolves; it is not a standalone npm package or a promise that a model account is already authenticated.

```js
import { WorkflowBuilder } from '@generatorai/shared';

const workflow = new WorkflowBuilder('review-and-plan')
  .name('Review and plan')
  .sessionMode('per-stage')
  .variable('objective', {
    type: 'text',
    label: 'Objective',
    required: true,
  })
  .stage('inspect', stage => stage
    .name('Inspect source')
    .prompt('Inspect the selected codebase for {{objective}}. Report findings.')
    .timeout(120_000))
  .stage('plan', stage => stage
    .name('Draft implementation plan')
    .prompt('Use the inspection findings to propose a verifiable implementation plan.')
    .contextFrom(['inspect']))
  .edge('inspect', 'plan', 'on_success')
  .build();

const profiles = [{
  version: 1,
  name: 'Documentation review',
  variables: { objective: 'documentation coverage' },
}];

export { workflow, profiles };
```

## Builder capabilities

The workflow builder supports identity, tags, session mode, typed variables, harness settings, allowed/excluded tools, stage/edge creation, skill/agent references, workflow hooks, preprocessing, validations, and workspace policy. Stage builders support inline or file prompts, multiple prompts, agent bindings, timeout/retry policy, context filtering and sources, output format/schema, variables, iteration configuration, skills, and hooks.

Graph construction validates identifiers, duplicate stage IDs, stage-count limits, and cycles. Runtime schema validation is still relevant: builder methods, script output schemas, and materialization must agree. For advanced fields, consult the current contracts rather than assuming every builder value survives every older export/import path.

## Profiles and hooks

Profiles provide named runtime presets, including variables, session mode, permission policy, and stage overrides such as skipping a stage. A profile that references an unavailable provider or model must be corrected for the target host. Examples in `templates/scripts` demonstrate graph branching, fan-in, hooks, and profiles; their hard-coded model choices are examples and may not match the current account.

Script imports and hook functions execute code. Treat an imported script as software that runs on the GeneratorAI host. Lifecycle functions can alter variables or perform side effects, so review them before materializing/running an unfamiliar script.

## Source evidence

`apps/web/src/pages/ScriptsListPage.tsx`, `apps/web/src/pages/ScriptDetailPage.tsx`, `apps/web/src/hooks/scriptQueries.ts`, `packages/shared/src/builders/WorkflowBuilder.ts`, `packages/shared/src/builders/StageBuilder.ts`, `packages/shared/src/config/WorkflowScriptSchema.ts`, and `templates/scripts/code-review.workflow.mjs`.

## Configuration and worked examples

[Scripts](../configuration/scripts.md), [Templates](../configuration/templates.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.
