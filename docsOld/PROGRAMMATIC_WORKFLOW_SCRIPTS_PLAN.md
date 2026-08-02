# Programmatic Workflow Scripts (PWS) — Implementation Plan

> **Status**: Draft — Awaiting Review  
> **Author**: AI Assistant  
> **Date**: 2026-05-24  
> **Depends On**: Template system, WorkflowDefinitionService, RunProfile, Hook system, Automation pipeline

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Architecture Decision Records](#3-architecture-decision-records)
4. [Detailed Design](#4-detailed-design)
5. [Edge Cases & Mitigations](#5-edge-cases--mitigations)
6. [Implementation Phases](#6-implementation-phases)
7. [Comparison with Modern Systems](#7-comparison-with-modern-systems)
8. [File Changes Summary](#8-file-changes-summary)
9. [Risk Assessment](#9-risk-assessment)
10. [Success Criteria](#10-success-criteria)

---

## 1. Executive Summary

### Problem Statement

GeneratorAI currently provides **only** a declarative JSON template system for defining workflows. While templates work for standard patterns, they lack:

- **Dynamic logic**: Cannot compute stages based on runtime data (e.g., file lists, API responses)
- **Conditional DAG construction**: Cannot programmatically add/remove stages based on input
- **Inline hook functions**: Cannot define lifecycle hooks as code alongside the workflow
- **Co-located run profiles**: Cannot bundle execution configurations with the definition
- **IDE support**: JSON offers no autocomplete for the complex nested schema

### Proposed Solution

Provide a **code-first** alternative where users write `.workflow.mjs` ESM scripts that programmatically construct workflows using a fluent TypeScript builder SDK. Scripts live alongside workflow folders (like templates today) and are dynamically imported at runtime via native ESM `import()`.

### Industry Context

| System | Declarative | Programmatic |
|--------|-------------|--------------|
| **GeneratorAI (current)** | Template JSON | ❌ Not available |
| **GeneratorAI (proposed)** | Template JSON | `.mjs` Workflow Script |
| **Mastra** | — | `createWorkflow()` + `createStep()` code-first |
| **LangGraph** | — | `StateGraph().addNode().addEdge()` code-first |
| **Inngest** | — | `inngest.createFunction()` code-first |
| **Temporal** | — | Workflow/Activity code-first |
| **Dagger** | YAML CI (legacy) | TypeScript/Go/Python functions |
| **OpenAI Agents SDK** | — | `Agent()` + `Runner.run_sync()` code-first |
| **Vercel AI SDK** | — | `ToolLoopAgent` + `generateText()` code-first |

All modern agentic workflow frameworks are **code-first by default**. GeneratorAI's JSON templates are the exception. This feature brings parity while preserving the existing template system for simpler use cases.

---

## 2. Requirements Analysis

### 2.1 Core Requirements

| # | Requirement | Rationale |
|---|---|---|
| R1 | User writes a `.mjs` script that exports a workflow definition | Code-first control over DAG structure, prompts, hooks, variables |
| R2 | Script is placed in a workflow folder and pointed to (like templates) | Consistent with existing template discovery pattern |
| R3 | Script is dynamically imported at runtime using ESM `import()` | No CommonJS; leverages native Node 20+ ESM support |
| R4 | User has full access to all workflow/stage/hook/variable options | Parity with template JSON — no feature regression |
| R5 | Script can define RunProfile(s) for different input configurations | Same workflow, multiple execution profiles |
| R6 | Works across all supported clients: Web UI, CLI, Server API | Feature parity across all surfaces |
| R7 | Integrates with automation system (batch/loop execution) | Scripts can be targeted by automations like templates |

### 2.2 Derived Requirements (from Use Case Analysis)

| # | Requirement | Source |
|---|---|---|
| D1 | Builder SDK provides typed fluent API for constructing workflows | Developer ergonomics; TypeScript autocompletion |
| D2 | Script can reference external npm packages from workspace | Advanced dynamic behavior (e.g., read YAML, call APIs) |
| D3 | Script execution has a timeout boundary | Security: prevent infinite loops during import |
| D4 | Script errors produce actionable diagnostics (file, line, message) | Debuggability |
| D5 | Hot-reload capability (optional flag) for dev workflow | DX improvement over "restart server" |
| D6 | Script can define inline hook functions (not just script/http configs) | Mastra-like ergonomics: `execute: async ({ ctx }) => { ... }` |
| D7 | Validation of script output against existing Zod schemas | Prevents malformed definitions from entering DB |
| D8 | Script can programmatically compute stages (e.g., from file list) | Key advantage over static JSON templates |

### 2.3 Non-Requirements (Explicitly Out of Scope)

| # | Excluded | Reason |
|---|---|---|
| X1 | Full sandboxed VM execution | Trust boundary is localhost; no multi-tenant isolation needed |
| X2 | Browser-side script execution | Scripts run server-side only; web UI consumes outputs |
| X3 | Python/other language scripts | TypeScript/JavaScript ESM only; matches codebase language |
| X4 | Real-time collaborative script editing | Desktop/web editor is phase 4 polish, not core |
| X5 | Script marketplace/sharing | Internal-only for now; future consideration |

---

## 3. Architecture Decision Records

### ADR-1: Import Strategy — Direct `import()` vs Subprocess vs Worker Thread

#### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A: Direct `import()` in-process** | Fast, full type support, can return complex objects with closures/functions | Shares memory, crash in script crashes server |
| **B: Subprocess (fork + import)** | Isolated, crash-safe | Serialization boundary (no closures), slower, complex IPC |
| **C: Worker thread + import** | Isolated memory, shared binary heap possible | MessagePort serialization limits, moderate complexity |

#### Decision: **Option A (Direct `import()`) with validation boundary**

#### Rationale

1. **Trust boundary is localhost** — No user authentication per architecture doc. The user running the script IS the server operator.
2. **Industry precedent** — Mastra, LangGraph, Inngest, Temporal all use in-process code loading. None sandbox user workflow code.
3. **Existing precedent in codebase** — Hook functions of type `'function'` with `handlerName` already run in-process today (HookExecutor registry).
4. **Critical feature requirement** — Scripts must export **function references** for inline hooks. Functions cannot cross serialization boundaries (no closures in JSON).
5. **Output is validated data** — The script's output is just a data structure (WorkflowScriptOutput) validated by existing Zod schemas before DB insertion. It's not arbitrary code execution at run time.
6. **Sufficient safety via**:
   - 30s timeout via `Promise.race()` on the `import()` call
   - Zod validation on the returned data structure
   - `try/catch` wrapping with structured error reporting
   - Path validation (scripts must be within configured directories)
   - No server-side `eval()` of user strings

#### Rejected Alternatives

- **Subprocess**: Would make inline hook functions impossible (functions can't serialize). Would require a custom IPC protocol for complex objects. The added complexity provides no meaningful security benefit in a localhost-trust environment.
- **Worker thread**: Same serialization problem. `MessagePort` can transfer `ArrayBuffer` but not functions or closures. Would require redesigning the hook system.

---

### ADR-2: Script Discovery — File Convention

#### Decision: Scripts use `.workflow.mjs` extension, discovered from configurable directories.

#### Rationale

- `.mjs` guarantees ESM parsing by Node.js (no ambiguity with `package.json` type field)
- `.workflow.mjs` suffix distinguishes workflow scripts from hook scripts (`.hook.mjs`) and data-source scripts
- Mirrors existing pattern: TemplateRegistry scans directories for `.json` files
- Multiple discovery paths supported (configurable):
  - `templates/scripts/` — Bundled/system scripts
  - `<project-workspace>/workflows/` — Per-project scripts
  - User-configured paths via config

#### File Convention

```
templates/
  scripts/
    code-review.workflow.mjs        ← System workflow script
    full-pipeline.workflow.mjs      ← System workflow script
  system/
    code-generation.json            ← Existing JSON template (unchanged)
    code-review.json                ← Existing JSON template (unchanged)
projects/
  my-project/
    workflows/
      custom-review.workflow.mjs    ← Project-scoped workflow script
```

---

### ADR-3: Builder SDK Package Location

#### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A: In `packages/shared/src/builders/`** | No new package, available everywhere | Shared package grows larger |
| **B: New `packages/workflow-sdk/`** | Clean separation, publishable standalone | Another package to maintain, Turbo config |

#### Decision: **Option A initially** — Place in `packages/shared/src/builders/`. Extract to standalone package later if user demand warrants npm publishing.

#### Rationale

- Builder classes are pure data constructors with zero runtime dependencies beyond types
- They need access to shared types (`WorkflowDefinition`, `StageDefinition`, `HookPhase`, etc.) which live in `packages/shared`
- Avoids circular dependency (a new package would need to import shared types anyway)
- The `packages/shared` package is already imported by all consumers (server, CLI, core)

---

### ADR-4: Inline Hook Functions — Registration Strategy

#### Decision: Scripts export named functions as hook handlers. The system registers them in the existing `functionHandlers` Map at import time with deterministic names.

#### Mechanism

```javascript
// In user script:
export const workflow = builder
  .onRunStart(async (ctx) => {
    return { variables: { startTime: Date.now() } };
  })
  .build();
```

```typescript
// In WorkflowScriptLoader, after import:
for (const [hookId, handler] of scriptOutput.hooks.inlineFunctions) {
  const registrationKey = `script:${scriptOutput.id}:${hookId}`;
  hookExecutor.registerHandler(registrationKey, handler);
  // The hook definition in the DB stores: { type: 'function', config: { handlerName: registrationKey } }
}
```

#### Rationale

- **Zero architecture changes** to HookExecutor — it already supports in-process function lookup via `handlerName`
- Deterministic naming (`script:<scriptId>:<hookId>`) prevents collisions
- Functions remain in-process (no serialization needed)
- Same execution path as existing registered handlers — same timeout, error handling, HookResult contract

---

### ADR-5: RunProfile Co-location

#### Decision: A script can export a `profiles` array alongside the `workflow` export. Profiles are validated via `RunProfileSchema` and stored in DB linked to the materialized definition.

#### Example

```javascript
export const workflow = builder.build();

export const profiles = [
  {
    version: 1,
    name: "Quick Surface Review",
    variables: { depth: "surface", branch: "main" },
    permissionMode: "bypassPermissions",
    stageOverrides: [{ stageName: "security", skip: true }]
  },
  {
    version: 1,
    name: "Full Security Audit",
    variables: { depth: "comprehensive" },
    permissionMode: "plan",
    sessionMode: "per-stage"
  }
];
```

#### Rationale

- Keeps "what the workflow is" + "how to run it" as a single artifact
- Same pattern as Inngest (triggers defined alongside function body)
- Avoids separate profile files or manual DB entry
- Profiles are pure JSON-serializable objects — no special handling needed

---

### ADR-6: Relationship Between Script and Materialized Definition

#### Decision: Scripts produce **immutable** WorkflowDefinitions. Re-importing a modified script creates a **new version** (incremented `version` field), not an in-place mutation.

#### Rationale

- Matches existing template behavior (template import creates new definition)
- Running workflows are never affected by script changes (they reference a specific definition version)
- Supports rollback (keep old definitions, switch which one automations point to)
- Script path + content hash can be stored in `workflow_definitions.orchestrator_config` for traceability

---

## 4. Detailed Design

### 4.1 User-Facing Script API (Builder SDK)

#### Complete Example Script

```javascript
// templates/scripts/code-review.workflow.mjs
import { WorkflowBuilder } from '@generatorai/shared/builders';

const workflow = new WorkflowBuilder('code-review-pipeline')
  .name('Code Review Pipeline')
  .description('Multi-stage code review with security analysis')
  .sessionMode('per-stage')
  .tags(['code-review', 'security'])

  // ── User Input Variables ──
  .variable('repository', {
    type: 'git_url',
    label: 'Repository URL',
    required: true,
    description: 'The git repository to review'
  })
  .variable('branch', {
    type: 'string',
    label: 'Branch',
    required: true,
    defaultValue: 'main'
  })
  .variable('depth', {
    type: 'choice',
    label: 'Review Depth',
    options: ['surface', 'thorough', 'comprehensive'],
    required: true,
    defaultValue: 'thorough'
  })
  .variable('focusAreas', {
    type: 'text',
    label: 'Focus Areas',
    required: false,
    description: 'Specific areas to focus the review on'
  })

  // ── Harness Configuration ──
  .model('gpt-4.1')
  .systemPromptAppend('You are an expert code reviewer. Be concise and actionable.')
  .mcpServer('github', { type: 'stdio', command: 'gh-mcp-server' })

  // ── Preprocessing ──
  .preprocessingStep({
    type: 'clone_repo',
    name: 'Clone repository',
    config: { repoAlias: 'target' },
    failOnError: true,
    order: 0
  })

  // ── Stage Definitions ──
  .stage('analyze', stage => stage
    .name('Static Analysis')
    .description('Run static analysis and gather codebase metrics')
    .prompt(`
      Analyze the codebase in {{repository}} on branch {{branch}}.
      Focus areas: {{focusAreas}}
      
      Provide:
      1. Code structure overview
      2. Dependency analysis
      3. Potential issue areas
      4. Complexity metrics
    `)
    .timeout(120_000)
    .hook('pre_prompt', {
      type: 'script',
      command: 'npm run lint -- --quiet --format json',
      failurePolicy: 'skip'
    })
    .outputFormat('json')
    .outputSchema({
      type: 'object',
      properties: {
        issues: { type: 'array' },
        metrics: { type: 'object' },
        summary: { type: 'string' }
      }
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
    `)
    .agent('security-expert')
    .contextFrom(['analyze'])
    .retryPolicy({ maxRetries: 2, backoffMs: 5000, backoffMultiplier: 2 })
    .harnessOverrides({ reasoningEffort: 'high' })
  )

  .stage('performance', stage => stage
    .name('Performance Review')
    .description('Identify performance bottlenecks')
    .prompt(`
      Review the codebase for performance issues.
      Focus on hot paths, N+1 queries, memory leaks, and unnecessary allocations.
    `)
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
    `)
    .contextFilter('structured')
    .contextFrom(['analyze', 'security', 'performance'])
  )

  // ── DAG Edges ──
  .edge('analyze', 'security', 'on_success')
  .edge('analyze', 'performance', 'on_success')  // Parallel: security + performance
  .edge('security', 'report', 'on_completion')
  .edge('performance', 'report', 'on_completion')
  // Report waits for BOTH security and performance (fan-in)

  // ── Workflow-Level Inline Hooks ──
  .onRunStart(async (ctx) => {
    console.log(`[${ctx.workflowId}] Starting review of ${ctx.variables.repository}`);
    return { variables: { reviewStartedAt: new Date().toISOString() } };
  })
  .onRunComplete(async (ctx) => {
    // Post results to webhook, Slack, etc.
    if (ctx.variables.notifyUrl) {
      await fetch(ctx.variables.notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'complete', runId: ctx.runId })
      });
    }
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
      { stageName: 'performance', timeoutMs: 30000 }
    ]
  },
  {
    version: 1,
    name: 'Full Security Audit',
    description: 'Comprehensive security-focused review',
    variables: { depth: 'comprehensive' },
    permissionMode: 'plan',
    sessionMode: 'per-stage',
    stageOverrides: [
      { stageName: 'security', agentName: 'security-specialist', timeoutMs: 300000 }
    ]
  },
  {
    version: 1,
    name: 'CI Pipeline Review',
    description: 'Automated review for CI/CD integration',
    variables: { depth: 'thorough' },
    permissionMode: 'bypassPermissions',
    sessionMode: 'auto'
  }
];

export { workflow, profiles };
```

#### Dynamic Stage Generation Example

```javascript
// templates/scripts/multi-service-review.workflow.mjs
import { WorkflowBuilder } from '@generatorai/shared/builders';
import { readFileSync } from 'node:fs';

// Dynamic: read service list from workspace config
const servicesConfig = JSON.parse(
  readFileSync('./workspace/services.json', 'utf-8')
);

const builder = new WorkflowBuilder('multi-service-review')
  .name('Multi-Service Code Review')
  .sessionMode('per-stage')
  .variable('branch', { type: 'string', label: 'Branch', required: true });

// Dynamically create a review stage for each service
for (const service of servicesConfig.services) {
  builder.stage(`review-${service.name}`, stage => stage
    .name(`Review ${service.displayName}`)
    .prompt(`Review the ${service.name} service at path ${service.path}...`)
    .timeout(service.isLarge ? 180_000 : 60_000)
  );
}

// Create a summary stage that depends on ALL review stages
builder.stage('summary', stage => stage
  .name('Consolidated Summary')
  .prompt('Consolidate all service review findings...')
  .contextFilter('structured')
);

// Wire edges: each service review → summary
for (const service of servicesConfig.services) {
  builder.edge(`review-${service.name}`, 'summary', 'on_completion');
}

export const workflow = builder.build();
```

### 4.2 Builder Classes — Full API

```typescript
// packages/shared/src/builders/WorkflowBuilder.ts

export class WorkflowBuilder {
  // ═══ Constructor ═══
  constructor(id: string)

  // ═══ Identity ═══
  name(name: string): this
  description(description: string): this
  tags(tags: string[]): this

  // ═══ Session Mode ═══
  sessionMode(mode: 'single' | 'per-stage' | 'auto'): this

  // ═══ Variables (User Inputs) ═══
  variable(name: string, config: {
    type: 'string' | 'number' | 'boolean' | 'choice' | 'text' | 'git_url' | 'git_urls';
    label: string;
    description?: string;
    required: boolean;
    defaultValue?: unknown;
    options?: string[];  // For 'choice' type
  }): this

  // ═══ Harness (LLM) Configuration ═══
  model(model: string): this
  systemPromptAppend(content: string): this
  mcpServer(name: string, config: {
    type: 'http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
  }): this
  harnessConfig(config: Partial<CopilotConfig>): this
  availableTools(tools: string[]): this
  excludedTools(tools: string[]): this

  // ═══ Stages ═══
  stage(localId: string, configurator: (stage: StageBuilder) => StageBuilder): this

  // ═══ Edges (DAG Connections) ═══
  edge(
    fromStageId: string,
    toStageId: string,
    edgeType: 'on_success' | 'on_failure' | 'on_completion' | 'always',
    condition?: string
  ): this

  // ═══ Workflow-Level Hooks (Inline Functions) ═══
  onRunStart(handler: WorkflowHookHandler): this
  onRunComplete(handler: WorkflowHookHandler): this
  onRunFailed(handler: WorkflowHookHandler): this
  onRunCancelled(handler: WorkflowHookHandler): this
  onPreprocessingComplete(handler: WorkflowHookHandler): this
  onAllStagesScheduled(handler: WorkflowHookHandler): this

  // ═══ Workflow-Level Hooks (Declarative Config) ═══
  hook(phase: WorkflowHookPhase, config: HookDefinitionConfig): this

  // ═══ Orchestrator Configuration ═══
  preprocessingStep(step: PreprocessingStepConfig): this
  resultValidation(stageId: string, rules: ValidationRule[]): this
  orchestratorConfig(config: Partial<OrchestratorConfig>): this

  // ═══ Project Integration ═══
  requiresCodebase(requires: boolean): this
  useWorktree(use: boolean): this

  // ═══ Skills & Agents ═══
  skill(ref: SkillReference): this
  customAgent(agent: { name: string; description: string; instructions: string; tools?: string[] }): this

  // ═══ Build ═══
  build(): WorkflowScriptOutput
}
```

```typescript
// packages/shared/src/builders/StageBuilder.ts

export class StageBuilder {
  // ═══ Identity ═══
  name(name: string): this
  description(description: string): this

  // ═══ Prompts ═══
  prompt(text: string): this                              // Single inline prompt
  promptFile(path: string): this                          // Load from file
  prompts(prompts: PromptDefinition[]): this              // Multiple prompts

  // ═══ Agent Delegation ═══
  agent(agentName: string): this

  // ═══ Execution Control ═══
  timeout(ms: number): this
  retryPolicy(policy: { maxRetries: number; backoffMs: number; backoffMultiplier?: number }): this
  condition(expression: string): this                     // Incoming edge condition

  // ═══ Context Control ═══
  contextFilter(filter: 'full' | 'summary-only' | 'none' | 'structured'): this
  contextFrom(stageNames: string[]): this                 // Explicit context sources

  // ═══ Output Configuration ═══
  outputFormat(format: 'text' | 'json'): this
  outputSchema(schema: Record<string, unknown>): this
  expectedOutput(description: string): this

  // ═══ Variables ═══
  variables(vars: Record<string, unknown>): this

  // ═══ Hooks ═══
  hook(phase: StageHookPhase, config: HookDefinitionConfig | StageHookHandler): this

  // ═══ Harness Overrides (Per-Stage) ═══
  harnessOverrides(config: Partial<CopilotConfig>): this

  // ═══ Advanced: Iteration (Sub-Workflows) ═══
  iterationConfig(config: {
    subWorkflowDefinitionId: string;
    inputMapping: Record<string, string>;
    outputMapping: Record<string, string>;
    maxIterations: number;
    exitField?: string;
    exitValue?: string;
  }): this

  // ═══ Skills ═══
  skill(ref: StageSkillReference): this
}
```

### 4.3 Script Output Schema

```typescript
// packages/shared/src/types/WorkflowScript.ts

/**
 * The validated output produced by WorkflowBuilder.build().
 * This is the contract between user scripts and the system.
 */
export interface WorkflowScriptOutput {
  /** Script-defined unique identifier */
  id: string;

  /** Workflow definition parameters (ready for createDefinition()) */
  definition: {
    name: string;
    description?: string;
    sessionMode: 'single' | 'per-stage' | 'auto';
    harnessConfig?: Partial<CopilotConfig>;
    variables: VariableDefinition[];
    tags: string[];
    orchestratorConfig?: OrchestratorConfig;
    hooks?: WorkflowHookDefinition[];
    useWorktree?: boolean;
    skills?: SkillReference[];
    agents?: AgentReference[];
  };

  /** Stage definitions with local IDs for edge resolution */
  stages: Array<{
    localId: string;
    config: {
      name: string;
      description?: string;
      order: number;
      prompts: PromptDefinition[];
      hooks?: HookDefinition[];
      variables?: Record<string, unknown>;
      harnessConfigOverrides?: Partial<CopilotConfig>;
      agentName?: string;
      contextFilter?: 'full' | 'summary-only' | 'none' | 'structured';
      contextSources?: string[];
      outputFormat?: 'text' | 'json';
      outputSchema?: Record<string, unknown>;
      retryPolicy?: RetryPolicy;
      timeoutMs?: number;
      condition?: StageCondition;
      iterationConfig?: IterationConfig;
    };
  }>;

  /** DAG edges referencing local stage IDs */
  edges: Array<{
    from: string;
    to: string;
    edgeType: 'on_success' | 'on_failure' | 'on_completion' | 'always';
    condition?: string;
  }>;

  /** Inline hook function references (registered in-process) */
  inlineHooks?: Map<string, HookHandler>;
}

/**
 * Complete script module export contract.
 * A .workflow.mjs file must export at least { workflow }.
 */
export interface WorkflowScriptExports {
  workflow: WorkflowScriptOutput;
  profiles?: RunProfileConfig[];
  resolveIterations?: (context: IterationResolverContext) => Promise<Record<string, unknown>[]>;
}

/** Context provided to the optional resolveIterations export */
export interface IterationResolverContext {
  variables: Record<string, unknown>;
  projectId?: string;
  workspacePath?: string;
  signal: AbortSignal;
}
```

### 4.4 Script Loader Service

```typescript
// packages/core/src/services/WorkflowScriptLoader.ts

export interface ScriptMetadata {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  lastModified: Date;
  variables: VariableDefinition[];
  stageCount: number;
  profileCount: number;
}

export interface LoadedScript {
  metadata: ScriptMetadata;
  output: WorkflowScriptOutput;
  profiles: RunProfileConfig[];
  resolveIterations?: (ctx: IterationResolverContext) => Promise<Record<string, unknown>[]>;
}

export class WorkflowScriptLoader {
  private loadedScripts: Map<string, LoadedScript> = new Map();
  private readonly IMPORT_TIMEOUT_MS = 30_000;

  constructor(
    private readonly logger: Logger,
    private readonly scriptDirs: string[],
    private readonly hookExecutor: IHookExecutor,
  ) {}

  /**
   * Scan configured directories for .workflow.mjs files.
   * Called at boot (like TemplateRegistry) and on-demand for refresh.
   */
  async discoverScripts(): Promise<ScriptMetadata[]> {
    const metadata: ScriptMetadata[] = [];
    for (const dir of this.scriptDirs) {
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.workflow.mjs')) continue;
        try {
          const loaded = await this.loadScript(join(dir, file));
          metadata.push(loaded.metadata);
        } catch (err) {
          this.logger.warn({ err, file }, '[ScriptLoader] Failed to load script');
        }
      }
    }
    return metadata;
  }

  /**
   * Dynamically import and validate a single .workflow.mjs script.
   */
  async loadScript(scriptPath: string): Promise<LoadedScript> {
    // 1. Security: Validate path is within allowed directories
    this.validateScriptPath(scriptPath);

    // 2. Dynamic import with cache-busting for hot-reload support
    const fileUrl = pathToFileURL(resolve(scriptPath)).href;
    const importUrl = `${fileUrl}?t=${Date.now()}`;

    let module: WorkflowScriptExports;
    try {
      module = await Promise.race([
        import(importUrl),
        this.createTimeout(this.IMPORT_TIMEOUT_MS)
      ]) as WorkflowScriptExports;
    } catch (err) {
      throw new ScriptLoadError(
        `Failed to import script: ${scriptPath}`,
        { cause: err, scriptPath }
      );
    }

    // 3. Validate exports
    const { workflow, profiles = [], resolveIterations } = module;
    if (!workflow) {
      throw new ScriptValidationError(
        'Script must export a "workflow" object (use WorkflowBuilder.build())',
        { scriptPath }
      );
    }

    // 4. Validate workflow output against Zod schema
    const parsed = WorkflowScriptOutputSchema.safeParse(workflow);
    if (!parsed.success) {
      throw new ScriptValidationError(
        `Script output validation failed: ${parsed.error.message}`,
        { scriptPath, zodError: parsed.error }
      );
    }

    // 5. Validate profiles
    for (const profile of profiles) {
      const profileParsed = RunProfileSchema.safeParse(profile);
      if (!profileParsed.success) {
        this.logger.warn({ scriptPath, error: profileParsed.error },
          '[ScriptLoader] Invalid profile, skipping');
      }
    }

    // 6. Register inline hook functions
    if (workflow.inlineHooks) {
      for (const [hookId, handler] of workflow.inlineHooks) {
        const key = `script:${workflow.id}:${hookId}`;
        this.hookExecutor.registerHandler(key, handler);
        this.logger.debug({ key }, '[ScriptLoader] Registered inline hook');
      }
    }

    // 7. Build metadata and cache
    const stat = await fsStat(scriptPath);
    const loaded: LoadedScript = {
      metadata: {
        id: workflow.id,
        name: workflow.definition.name,
        description: workflow.definition.description,
        filePath: scriptPath,
        lastModified: stat.mtime,
        variables: workflow.definition.variables,
        stageCount: workflow.stages.length,
        profileCount: profiles.length,
      },
      output: parsed.data,
      profiles,
      resolveIterations,
    };

    this.loadedScripts.set(workflow.id, loaded);
    this.logger.info({ id: workflow.id, stages: workflow.stages.length },
      '[ScriptLoader] Loaded workflow script');

    return loaded;
  }

  /**
   * Materialize a script into DB entities (WorkflowDefinition + Stages + Edges).
   * Same flow as WorkflowOrchestrator.createFromTemplate().
   */
  async materialize(
    scriptId: string,
    overrides?: { name?: string; projectId?: string; variables?: Record<string, unknown> }
  ): Promise<{ definitionId: string; profileIds: string[] }> {
    // Delegates to WorkflowDefinitionService — covered in implementation
  }

  /** Get a previously loaded script by ID */
  getScript(id: string): LoadedScript | undefined {
    return this.loadedScripts.get(id);
  }

  /** Get all loaded scripts */
  getAllScripts(): LoadedScript[] {
    return Array.from(this.loadedScripts.values());
  }

  /** Force reload a specific script (hot-reload) */
  async reloadScript(id: string): Promise<LoadedScript> {
    const existing = this.loadedScripts.get(id);
    if (!existing) throw new NotFoundError(`Script not found: ${id}`);

    // Unregister old inline hooks
    if (existing.output.inlineHooks) {
      for (const [hookId] of existing.output.inlineHooks) {
        this.hookExecutor.unregisterHandler(`script:${id}:${hookId}`);
      }
    }

    return this.loadScript(existing.metadata.filePath);
  }

  // ─── Private Helpers ───

  private validateScriptPath(scriptPath: string): void {
    const resolved = resolve(scriptPath);
    const isAllowed = this.scriptDirs.some(dir =>
      resolved.startsWith(resolve(dir))
    );
    if (!isAllowed) {
      throw new SecurityError(
        `Script path not within allowed directories: ${scriptPath}`
      );
    }
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(`Script import exceeded ${ms}ms`)), ms)
    );
  }
}
```

### 4.5 Server Integration — New Endpoints

#### Route Definition

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/workflow-scripts` | GET | List all discovered scripts with metadata |
| `GET /api/workflow-scripts/:id` | GET | Get single script metadata + built output preview |
| `GET /api/workflow-scripts/:id/profiles` | GET | Get profiles defined in script |
| `POST /api/workflow-scripts/:id/materialize` | POST | Create WorkflowDefinition from script |
| `POST /api/workflow-scripts/:id/run` | POST | Materialize + create run + start (convenience) |
| `POST /api/workflow-scripts/reload` | POST | Force re-scan and reload all scripts |
| `POST /api/workflow-scripts/:id/reload` | POST | Reload single script |
| `POST /api/workflow-scripts/validate` | POST | Validate script at given path (dev tool) |

#### Request/Response Examples

**List Scripts**:
```http
GET /api/workflow-scripts

Response 200:
[
  {
    "id": "code-review-pipeline",
    "name": "Code Review Pipeline",
    "description": "Multi-stage code review with security analysis",
    "filePath": "templates/scripts/code-review.workflow.mjs",
    "lastModified": "2026-05-24T10:30:00Z",
    "variables": [...],
    "stageCount": 4,
    "profileCount": 3
  }
]
```

**Materialize Script**:
```http
POST /api/workflow-scripts/code-review-pipeline/materialize
Content-Type: application/json

{
  "name": "My Code Review",              // Optional name override
  "projectId": "proj-123",               // Optional project scope
  "variables": { "branch": "feature-x" } // Optional variable defaults
}

Response 201:
{
  "definitionId": "def-uuid-123",
  "profileIds": ["prof-1", "prof-2", "prof-3"],
  "definition": { ... }
}
```

**Run Script Directly**:
```http
POST /api/workflow-scripts/code-review-pipeline/run
Content-Type: application/json

{
  "profileName": "Quick Surface Review",    // Or provide variables directly
  "variables": { "repository": "https://github.com/org/repo.git" }
}

Response 202:
{
  "definitionId": "def-uuid-123",
  "runId": "run-uuid-456",
  "status": "running"
}
```

### 4.6 CLI Integration

#### New Commands

```bash
# ═══ Discovery & Inspection ═══

generatorai workflow script list
# Output:
# ID                      Name                    Stages  Profiles  Modified
# code-review-pipeline    Code Review Pipeline    4       3         2026-05-24
# multi-service-review    Multi-Service Review    12      1         2026-05-23

generatorai workflow script show <id>
# Shows: full metadata, variable definitions, stage list, edges, profiles

generatorai workflow script validate <path>
# Validates a .workflow.mjs file without loading into registry
# Shows: ✓ Valid | ✗ Errors with file:line details

# ═══ Execution ═══

generatorai workflow script run <id>
# Interactive mode: prompts for required variables, shows profile picker
  --profile <name>                # Use named profile from script
  --var key=value                 # Override specific variables (repeatable)
  --project <id>                  # Scope to project
  --no-materialize                # Skip creating persistent definition (ephemeral run)

generatorai workflow script materialize <id>
# Create persistent WorkflowDefinition in DB from script
  --name <name>                   # Override name
  --project <id>                  # Scope to project

# ═══ Development ═══

generatorai workflow script init <name>
# Scaffold a new .workflow.mjs file with imports, builder pattern, types comment
  --dir <path>                    # Target directory (default: ./workflows/)
  --stages <n>                    # Number of starter stages
  --with-hooks                    # Include example inline hooks
  --with-profiles                 # Include example profiles

generatorai workflow script watch <dir>
# Dev mode: watch directory for .workflow.mjs changes, auto-reload on save
# Shows live validation results in terminal

# ═══ Management ═══

generatorai workflow script reload [id]
# Reload specific script or all scripts from disk
```

#### TUI Integration Points

The Ink-based TUI gets script integration in these views:

1. **Workflow creation menu** — New option: "From Script" alongside "From Template" and "Manual"
2. **Script picker** — List view with search, shows stage count and profile count
3. **Variable form** — Auto-generated from script's variable definitions
4. **Profile picker** — When script has profiles, show selection before run
5. **DAG preview** — ASCII DAG visualization from script's edges

### 4.7 Web UI Integration

#### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `WorkflowScriptPanel` | `apps/web/src/components/scripts/` | List/grid of discovered scripts |
| `ScriptDetailView` | Same | Script metadata, DAG preview, variable form |
| `ScriptProfileSelector` | Same | Profile picker modal |
| `ScriptDagPreview` | Same | React Flow visualization of script's DAG |

#### Integration Points in Existing UI

1. **WorkflowListPage** — Add "From Script" tab/button in the "Create" workflow dialog
2. **WorkflowBuilderPage** — "Import from Script" option loads script DAG into visual editor
3. **RunDialog** — When definition was created from script, show profile dropdown
4. **Sidebar** — "Scripts" section under "Templates" in navigation

#### Platform Client Additions

```typescript
// Added to HttpPlatformClient and DirectPlatformClient

// Script operations
listScripts(): Promise<ScriptMetadata[]>
getScript(id: string): Promise<ScriptDetail>
getScriptProfiles(id: string): Promise<RunProfileConfig[]>
materializeScript(id: string, params: MaterializeParams): Promise<MaterializeResult>
runScript(id: string, params: RunScriptParams): Promise<{ definitionId: string; runId: string }>
reloadScripts(): Promise<void>
reloadScript(id: string): Promise<ScriptMetadata>
validateScript(path: string): Promise<ValidationResult>
```

### 4.8 Automation Integration

Scripts integrate with the automation system in two ways:

#### A. Script-Materialized Definitions in Automations

After materializing a script, the resulting `workflowDefinitionId` is used in automations exactly like any other definition:

```json
{
  "name": "Nightly Code Review",
  "trigger": "schedule",
  "cronExpression": "0 2 * * *",
  "workflowIds": ["def-from-script-uuid"],
  "inputMode": "batch",
  "dataSourceConfig": { "type": "http", "url": "https://api.github.com/repos/org/repo/pulls" }
}
```

#### B. Script-Based Iteration Resolution (New Input Mode)

Scripts can export a `resolveIterations` function for dynamic data sourcing:

```javascript
// In the .workflow.mjs script:
export async function resolveIterations(context) {
  const { variables, signal } = context;

  // Fetch PRs dynamically
  const response = await fetch(
    `https://api.github.com/repos/${variables.org}/${variables.repo}/pulls?state=open`,
    { signal }
  );
  const prs = await response.json();

  return prs.map(pr => ({
    pr_number: pr.number,
    pr_title: pr.title,
    pr_branch: pr.head.ref,
    pr_author: pr.user.login,
  }));
}
```

This integrates with `AutomationService` as a new data source type:

```typescript
// In DataSourceResolver.ts — new case:
case 'workflow_script': {
  const script = this.scriptLoader.getScript(config.scriptId);
  if (!script?.resolveIterations) {
    throw new ValidationError('Script does not export resolveIterations');
  }
  return await script.resolveIterations({ variables, projectId, signal });
}
```

#### C. Profile-Based Automation

Automations can reference a profile name instead of manual variable configuration:

```json
{
  "workflowIds": ["def-from-script"],
  "runProfileName": "Full Security Audit",
  "inputMode": "single"
}
```

The automation executor resolves the profile, merges its variables with automation-level variables, and applies stage overrides before creating the run.

---

## 5. Edge Cases & Mitigations

| # | Edge Case | Likelihood | Impact | Mitigation |
|---|-----------|-----------|--------|-----------|
| E1 | Script has syntax error preventing import | High (dev time) | Low | Caught by `import()` rejection; wrapped in `ScriptLoadError` with original stack trace showing file:line |
| E2 | Script hangs during import (infinite loop in top-level code) | Medium | Medium | 30s timeout via `Promise.race()`; timeout error includes script path |
| E3 | Script imports unavailable npm package | Medium | Low | Error: "Cannot find module 'X'. Install it in the workspace: `pnpm add X`" |
| E4 | Script exports invalid structure (missing required fields) | Medium | Low | Zod validation catches at load time; detailed field-level error messages |
| E5 | Two scripts export same ID | Low | Medium | First-loaded wins; second logged as WARNING with both paths. CLI `validate` command detects conflicts |
| E6 | Script file changes on disk after caching | Medium | Low | Cache-busting via `?t=timestamp` on import URL. Manual reload via API/CLI. Optional file watcher in dev mode |
| E7 | Inline hook function throws at run time | Medium | Medium | Existing HookExecutor error handling applies (failurePolicy: abort/skip/continue) |
| E8 | Script references non-existent stage in edge definition | Medium | Low | Builder's `.build()` validates: throws if edge references unknown localId |
| E9 | Script produces circular DAG (cycles) | Low | High | Builder's `.build()` runs cycle detection (existing DAGValidator logic) |
| E10 | RunProfile references non-existent stage name | Low | Low | Validated at materialize-time against actual stage list |
| E11 | Script reads sensitive files from filesystem | Low (localhost trust) | Low | Path validation ensures scripts are from configured directories. Document risk in security notes |
| E12 | Hot-reload causes stale inline hooks | Low | Medium | Reload deregisters old hooks before re-registering. Hook key format ensures no orphans |
| E13 | Script produces > 100 stages (performance) | Low | Medium | Builder enforces max stage limit (configurable, default 50). Warning at 20+ |
| E14 | Automation targets stale materialized definition | Medium | Low | Script version tracked in `orchestrator_config`. CLI/UI can show "outdated" badge |
| E15 | Import URL caching by Node.js module loader | Medium | Medium | Query string `?t=timestamp` ensures fresh import each time |

---

## 6. Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

**Estimated scope**: ~15 files new, ~5 files edited

| # | Task | Package | Dependencies |
|---|------|---------|------|
| 1.1 | `WorkflowBuilder` class | `packages/shared/src/builders/` | Types from shared |
| 1.2 | `StageBuilder` class | `packages/shared/src/builders/` | Types from shared |
| 1.3 | `WorkflowScriptOutput` type + Zod schema | `packages/shared/src/types/` + `config/` | Existing schemas |
| 1.4 | Builder barrel export (`index.ts`) | `packages/shared/src/builders/` | 1.1, 1.2 |
| 1.5 | `WorkflowScriptLoader` service | `packages/core/src/services/` | 1.3 |
| 1.6 | `ScriptRegistry` (discover/cache) | `packages/core/src/services/` | 1.5 |
| 1.7 | Server routes (`workflowScripts.ts`) | `apps/server/src/routes/` | 1.5, 1.6 |
| 1.8 | Mount routes + DI wiring | `apps/server/src/` | 1.7 |
| 1.9 | Example script (`code-review.workflow.mjs`) | `templates/scripts/` | 1.1, 1.2 |
| 1.10 | Unit tests for builder | `packages/shared/__tests__/` | 1.1, 1.2 |
| 1.11 | Unit tests for loader | `packages/core/__tests__/` | 1.5 |

### Phase 2: Client Integration

**Estimated scope**: ~10 files new, ~8 files edited

| # | Task | Package | Dependencies |
|---|------|---------|------|
| 2.1 | CLI `workflow script` command group | `apps/cli/src/commands/` | Phase 1 |
| 2.2 | CLI subcommands: list, show, validate | Same | 2.1 |
| 2.3 | CLI subcommands: run, materialize | Same | 2.1 |
| 2.4 | CLI subcommand: init (scaffolding) | Same | 2.1 |
| 2.5 | Platform client methods | `apps/web/src/services/` + CLI | Phase 1 routes |
| 2.6 | Web: ScriptListPanel component | `apps/web/src/components/` | 2.5 |
| 2.7 | Web: ScriptDetailView + DAG preview | Same | 2.6 |
| 2.8 | Web: Integration in WorkflowListPage | Same | 2.6 |
| 2.9 | Web: ProfileSelector in RunDialog | Same | 2.5 |

### Phase 3: Automation & Advanced Features

**Estimated scope**: ~5 files new, ~6 files edited

| # | Task | Package | Dependencies |
|---|------|---------|------|
| 3.1 | `resolveIterations` integration in DataSourceResolver | `packages/core/src/services/` | Phase 1 |
| 3.2 | Profile-based automation execution | `packages/core/src/services/` | Phase 1 |
| 3.3 | RunProfile persistence linked to definitions | `packages/db/src/` | Phase 1 |
| 3.4 | Hot-reload file watcher (dev mode) | `packages/core/src/services/` | Phase 1 |
| 3.5 | CLI `workflow script watch` command | `apps/cli/src/commands/` | 3.4 |
| 3.6 | `script_source` column in workflow_definitions | `packages/db/src/` | Migration |

### Phase 4: DX Polish

**Estimated scope**: ~4 files new, ~2 files edited

| # | Task | Package | Dependencies |
|---|------|---------|------|
| 4.1 | TypeScript `.d.ts` declarations for builder | `packages/shared/` | Phase 1 |
| 4.2 | Documentation (`docs/workflow-scripts.md`) | `docs/` | All phases |
| 4.3 | Script editor in web UI (Monaco) | `apps/web/src/components/` | Phase 2 |
| 4.4 | Script versioning + "outdated" indicators | Multiple | Phase 3 |
| 4.5 | E2E tests (script → run → complete) | `agent-tests/` | Phases 1-3 |

---

## 7. Comparison with Modern Systems

### Feature Matrix

| Feature | GeneratorAI PWS | Mastra | LangGraph.js | Inngest | Temporal TS | OpenAI Agents |
|---------|----------------|--------|-------------|---------|------------|---------------|
| **Language** | TypeScript ESM | TypeScript | TypeScript | TypeScript | TypeScript | Python |
| **DAG definition** | Fluent builder | `.then()/.parallel()` | `addNode()/addEdge()` | Sequential steps | Code flow | Handoffs |
| **Schema validation** | Zod (I/O) | Zod/Valibot | — | Zod | — | Pydantic |
| **Hook system** | 22+ phases, 3 types | Before/After | — | Middleware | Interceptors | Lifecycle |
| **Inline functions** | ✅ (in-process) | ✅ (`execute:`) | ✅ (node fns) | ✅ (`step.run()`) | ✅ (Activities) | ✅ (tools) |
| **Run profiles** | ✅ (co-located) | ❌ | ❌ | ✅ (events) | ❌ | ❌ |
| **Visual DAG editor** | React Flow | Mastra Studio | LangSmith | Dashboard | Temporal UI | ❌ |
| **Batch/Loop exec** | ✅ (automation) | ❌ | ❌ | ✅ (fan-out) | ✅ (child WF) | ❌ |
| **Suspend/Resume** | ✅ (HITL) | ✅ | ✅ (checkpoints) | ✅ (sleep/wait) | ✅ (signals) | ❌ |
| **Multi-LLM** | ✅ (Copilot + Anthropic) | ✅ (any) | ✅ (any) | N/A | N/A | OpenAI only |
| **Declarative fallback** | ✅ (JSON templates) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Dynamic stage gen** | ✅ (code-time) | ❌ | ✅ | ❌ | ✅ | ❌ |
| **Sandbox execution** | ✅ (Docker/host) | ❌ | ❌ | ❌ | ❌ | ✅ (sandbox agents) |

### Key Differentiators of GeneratorAI PWS

1. **Dual-path design** — JSON templates for no-code users, scripts for power users. No other system offers both.
2. **22 hook phases** — Far more lifecycle integration points than any competitor.
3. **Run profiles** — Co-located parameterized execution configs. Unique to this system.
4. **Automation batch processing** — Native batch/loop over multiple inputs with parallelism control.
5. **Multi-SDK backend** — Same workflow runs on Copilot SDK or Anthropic SDK (provider-agnostic).
6. **Visual + Code parity** — Script-created workflows appear in React Flow editor. Mastra Studio comes close but doesn't support editing script-generated workflows.

### Design Philosophy Alignment

| Principle | Source | How PWS Implements |
|-----------|--------|---|
| "Python-first: use built-in language features" | OpenAI Agents SDK | TypeScript-first: use ESM, async/await, closures natively |
| "Enough features to be worth using, few enough to learn quickly" | OpenAI Agents SDK | Builder API has <20 methods. Build in 5 minutes, master in an hour |
| "Works great out of the box, customize exactly what happens" | OpenAI Agents SDK | Sensible defaults (auto session, on_success edges). Override anything |
| "Steps are the building blocks" | Mastra | Stages are the building blocks. Same concept, same fluent API |
| "Code within code — functions calling themselves" | Inngest/Temporal | Inline hooks, resolveIterations, dynamic stage generation |

---

## 8. File Changes Summary

### New Files

| Path | Purpose |
|------|---------|
| `packages/shared/src/builders/WorkflowBuilder.ts` | Core workflow builder class |
| `packages/shared/src/builders/StageBuilder.ts` | Stage builder class |
| `packages/shared/src/builders/types.ts` | Builder-specific types and interfaces |
| `packages/shared/src/builders/index.ts` | Barrel export |
| `packages/shared/src/types/WorkflowScript.ts` | WorkflowScriptOutput, WorkflowScriptExports types |
| `packages/shared/src/config/WorkflowScriptSchema.ts` | Zod validation schemas for script outputs |
| `packages/core/src/services/WorkflowScriptLoader.ts` | Script import, validation, caching |
| `packages/core/src/services/ScriptRegistry.ts` | Discovery and lifecycle management |
| `apps/server/src/routes/workflowScripts.ts` | REST API endpoints |
| `apps/cli/src/commands/workflow-script.ts` | CLI command group |
| `apps/web/src/components/scripts/WorkflowScriptPanel.tsx` | UI: script list |
| `apps/web/src/components/scripts/ScriptDetailView.tsx` | UI: script preview |
| `apps/web/src/components/scripts/ScriptProfileSelector.tsx` | UI: profile picker |
| `templates/scripts/code-review.workflow.mjs` | Example bundled script |
| `templates/scripts/multi-service-review.workflow.mjs` | Example dynamic script |
| `docs/workflow-scripts.md` | User-facing documentation |
| `packages/shared/__tests__/builders.test.ts` | Builder unit tests |
| `packages/core/__tests__/WorkflowScriptLoader.test.ts` | Loader unit tests |

### Modified Files

| Path | Change |
|------|--------|
| `apps/server/src/routes/index.ts` | Mount `/api/workflow-scripts` router |
| `apps/server/src/composition-root.ts` | Wire `WorkflowScriptLoader`, `ScriptRegistry` |
| `apps/web/src/services/platformClient.ts` | Add script-related methods |
| `apps/web/src/pages/WorkflowListPage.tsx` | Add "From Script" creation option |
| `apps/cli/src/commands/workflow.ts` | Register `script` subcommand group |
| `packages/shared/src/index.ts` | Export builders |
| `packages/core/src/services/DataSourceResolver.ts` | Add `'workflow_script'` type support |
| `packages/core/src/services/AutomationService.ts` | Profile-based run support |
| `packages/db/src/schema.ts` | Optional: `script_source` metadata column |
| `packages/shared/src/config/index.ts` | Export new schemas |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Severity | Mitigation Strategy |
|------|-----------|--------|----------|---|
| User scripts crash Node.js process | Low | High | Medium | `try/catch` + timeout. Localhost trust model means crashes only affect the operator. Document that scripts run in-process. |
| Node.js ESM import caching prevents reload | Medium | Medium | Medium | URL query parameter cache-busting (`?t=timestamp`). Verified working in Node 20+. |
| Builder API surface grows too large over time | Medium | Medium | Medium | Start with minimal API (Phase 1). Use versioned `build()` output. Extensive test suite prevents regression. |
| Type mismatch between builder output and DB schema | Low | High | Medium | Single Zod schema validates both template-imported and script-imported paths. Shared types prevent drift. |
| Performance impact of scanning script directories | Low | Low | Low | Scan at boot (same as templates). Lazy re-scan on explicit reload request. No polling. |
| Breaking changes to builder API | Medium | Medium | Medium | Version field in `WorkflowScriptOutput`. Backward-compatible additions only. Deprecation warnings. |
| Inline hooks hold stale closures after reload | Low | Medium | Low | Reload deregisters by key before re-registering. Old hook references in DB still point to (now-updated) key. |
| Scripts with top-level `await` (e.g., fetching data) | Medium | Low | Low | Fully supported by ESM. Timeout still applies. Document that top-level async is allowed. |

---

## 10. Success Criteria

### Must-Have (Phase 1 Gate)

- [ ] A user can write a `.workflow.mjs` file using `WorkflowBuilder` that defines stages, edges, variables, and hooks
- [ ] The file is discovered by `ScriptRegistry` on server boot
- [ ] The script is importable via `WorkflowScriptLoader` with timeout + validation
- [ ] `POST /api/workflow-scripts/:id/materialize` creates valid `WorkflowDefinition` + `StageDefinition[]` + `StageEdge[]` in DB
- [ ] The materialized definition is runnable via existing `POST /workflow-runs` flow
- [ ] Inline hook functions execute correctly via existing HookExecutor path
- [ ] Script validation errors produce actionable error messages with file paths

### Should-Have (Phase 2 Gate)

- [ ] CLI commands `workflow script list|show|run|validate|init` work end-to-end
- [ ] Web UI shows scripts in "Create Workflow" dialog
- [ ] RunProfiles from scripts are selectable when starting a run
- [ ] `DirectPlatformClient` (CLI direct mode) supports script operations

### Nice-to-Have (Phase 3+)

- [ ] `resolveIterations` works as a data source in automations
- [ ] Hot-reload via file watcher in dev mode
- [ ] Script editor in web UI
- [ ] "Outdated definition" badge when script has been modified since last materialize
- [ ] E2E test: script → materialize → run → complete → verify output

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Workflow Script** | A `.workflow.mjs` file that programmatically defines a workflow using the Builder SDK |
| **Builder SDK** | The `WorkflowBuilder` + `StageBuilder` fluent API classes |
| **Materialize** | Converting a script's output into persistent DB entities (definition + stages + edges) |
| **Inline Hook** | A function defined in the script that runs in-process during workflow execution |
| **Run Profile** | A named set of variable values + overrides for parameterized execution |
| **Script Registry** | The in-memory cache of discovered and loaded scripts (parallel to TemplateRegistry) |
| **localId** | The script-local stage identifier (e.g., "analyze") used in edge definitions, resolved to UUIDs at materialize time |

---

## Appendix B: Migration Path

Existing template JSON workflows are **not affected**. The two systems coexist:

```
User wants to create a workflow
  ├── Option A: Pick from Template Gallery (existing JSON templates)
  ├── Option B: Pick from Script Gallery (new .workflow.mjs scripts)
  ├── Option C: Manual creation via API/UI (existing CRUD endpoints)
  └── Option D: Import from JSON file (existing import endpoint)
```

Scripts are an **additional creation path**, not a replacement. Templates remain the recommended approach for simple, static workflows that don't need programmatic logic.

---

## Appendix C: Security Considerations

| Concern | Analysis | Decision |
|---------|----------|----------|
| **Arbitrary code execution** | Scripts can run any JS. Risk accepted because trust boundary is localhost (single operator). | Document clearly. No remote script loading. |
| **File system access** | Scripts can `readFileSync()` any file the Node process can read. | Accepted (localhost trust). Path validation on script locations only. |
| **Network access** | Scripts can `fetch()` external URLs. | Accepted. Same trust as data-source scripts and HTTP hooks today. |
| **Process pollution** | Scripts share the Node.js process. Could modify globals. | Low risk in practice. Document as anti-pattern. Monitor for issues. |
| **Dependency supply chain** | Scripts can import any installed package. | Same risk as the server itself. No additional mitigation needed. |
| **Future multi-tenant** | If auth is ever added, scripts would need sandboxing. | Flag as SEC-02 in roadmap. Current design doesn't preclude future subprocess isolation. |
