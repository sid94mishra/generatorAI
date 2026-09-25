// ────────────────────────────────────────────────────────────────
// Authoring-time builders (PD-16): a fluent API for `.workflow.mjs`
// scripts and SDK callers that emits the canonical `WorkflowGraph`.
// Every schema field is reachable; the result goes through the same
// validator as any other document, and is materialized by the one
// materializer (`createFromSpec`) like an import.
//
//   import { workflow } from '@generatorai/workflow-spec/builders';
//   export default workflow('Fix and review')
//     .variable('issue', { type: 'string', label: 'Issue', required: true })
//     .stage('fix', (s) => s.prompt('Fix {{issue}}'))
//     .stage('review', (s) => s.prompt('Review the fix').outputSchema({ type: 'object', … }))
//     .edge('fix', 'review')
//     .build();
//
// Inline hook handlers become function hooks with generated handler names;
// `buildWithHandlers()` returns them for the script loader to register.
// ────────────────────────────────────────────────────────────────

import { ENGINE_LEVEL, type EngineLevel } from '../constants.js';
import type {
  ActionDefinition,
  CompensationAction,
  HookConfig,
  HookDefinition,
  PromptDefinition,
  ResultValidationRule,
  StageHookPhase,
  VariableDefinition,
  WorkflowHookDefinition,
  WorkflowHookPhase,
} from '../schemas/common.js';
import type { EdgeSpec } from '../schemas/edge.js';
import type { WorkflowGraph, WorkflowGraphInput } from '../schemas/graph.js';
import type { AgentOverrides, SessionSpec } from '../schemas/session.js';
import type {
  AgentStage,
  ApprovalSpec,
  Budget,
  ContextSpec,
  JoinPolicy,
  OutputContract,
  RepairPolicy,
  RetryPolicy,
  Timeouts,
} from '../schemas/stage.js';
import type { Lifecycle, PostProcessingStep, PreprocessingStep, WorkflowSpec } from '../schemas/workflow.js';
import { resolveSessionSpec } from '../session/resolveSessionSpec.js';
import type { ValidationIssue } from '../validate/issues.js';
import { validateWorkflow, type ValidationResult } from '../validate/validateWorkflow.js';

/** Context handed to an inline hook handler by the hook executor. */
export interface InlineHookContext {
  runId: string;
  stageKey?: string;
  variables: Record<string, unknown>;
  [key: string]: unknown;
}
export type InlineHookHandler = (ctx: InlineHookContext) => unknown;

type StageInput = Partial<Omit<AgentStage, 'key' | 'kind'>>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type In<T> = { [K in keyof T]?: T[K] };

export class WorkflowBuildError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(
      `Invalid workflow:\n${issues
        .filter((i) => i.severity === 'error')
        .map((i) => `  ${i.code} at ${i.path || '/'}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`)
        .join('\n')}`,
    );
    this.name = 'WorkflowBuildError';
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'workflow';
}

interface BuildContext {
  workflowSlug: string;
  handlers: Map<string, InlineHookHandler>;
}

export class StageBuilder {
  private readonly spec: Mutable<StageInput> = {};
  private readonly inline: Array<{ phase: StageHookPhase; handler: InlineHookHandler; opts: In<HookDefinition> }> = [];

  constructor(readonly key: string) {}

  name(name: string): this {
    this.spec.name = name;
    return this;
  }
  description(text: string): this {
    this.spec.description = text;
    return this;
  }
  /** Parent container stage (loop, map, sub-workflow bodies). */
  parent(key: string): this {
    this.spec.parentKey = key;
    return this;
  }
  /** Append a prompt turn. */
  prompt(text: string, label?: string): this {
    this.spec.prompts = [...(this.spec.prompts ?? []), { label: label ?? `prompt ${(this.spec.prompts?.length ?? 0) + 1}`, text }];
    return this;
  }
  prompts(prompts: PromptDefinition[]): this {
    this.spec.prompts = [...prompts];
    return this;
  }
  /** Append a prompt used from the second loop iteration on. */
  followUp(text: string, label?: string): this {
    const list = this.spec.followUpPrompts ?? [];
    this.spec.followUpPrompts = [...list, { label: label ?? `follow-up ${list.length + 1}`, text }];
    return this;
  }
  /** Merge session settings (the most recent call wins per field). */
  session(session: SessionSpec): this {
    this.spec.session = resolveSessionSpec(this.spec.session, session);
    return this;
  }
  agent(agentRef: string, overrides?: AgentOverrides): this {
    return this.session({ agentRef, ...(overrides ? { agentOverrides: overrides } : {}) });
  }
  model(model: string): this {
    return this.session({ model });
  }
  sessionReuse(mode: 'fresh' | 'continue'): this {
    this.spec.sessionReuse = mode;
    return this;
  }
  sessionGroup(group: string): this {
    this.spec.sessionGroup = group;
    return this;
  }
  guard(expr: string): this {
    this.spec.guard = expr;
    return this;
  }
  join(policy: In<JoinPolicy> & { mode: JoinPolicy['mode'] }): this {
    this.spec.join = policy as JoinPolicy;
    return this;
  }
  retry(policy: In<RetryPolicy>): this {
    this.spec.retry = policy as RetryPolicy;
    return this;
  }
  repair(policy: In<RepairPolicy> = {}): this {
    this.spec.repair = policy as RepairPolicy;
    return this;
  }
  onExhausted(action: 'pause' | 'fail'): this {
    this.spec.onExhausted = action;
    return this;
  }
  timeouts(timeouts: Timeouts): this {
    this.spec.timeouts = { ...this.spec.timeouts, ...timeouts };
    return this;
  }
  budget(budget: Budget): this {
    this.spec.budget = { ...this.spec.budget, ...budget };
    return this;
  }
  /** Merge output-contract fields. */
  output(contract: In<OutputContract>): this {
    this.spec.output = { ...(this.spec.output ?? {}), ...contract } as OutputContract;
    return this;
  }
  /** Structured JSON output validated against `schema`. */
  outputSchema(schema: Record<string, unknown>): this {
    return this.output({ format: 'json', schema });
  }
  rule(rule: ResultValidationRule): this {
    return this.output({ rules: [...(this.spec.output?.rules ?? []), rule] });
  }
  context(spec: In<ContextSpec>): this {
    this.spec.context = spec as ContextSpec;
    return this;
  }
  contextFrom(keys: string[], mode: ContextSpec['mode'] = 'summary'): this {
    return this.context({ from: keys, mode });
  }
  approval(spec: In<ApprovalSpec> = {}): this {
    this.spec.approval = spec as ApprovalSpec;
    return this;
  }
  /** Add a hook definition, or an inline handler for a phase. */
  hook(def: HookDefinition): this;
  hook(phase: StageHookPhase, handler: InlineHookHandler, opts?: In<HookDefinition>): this;
  hook(a: HookDefinition | StageHookPhase, handler?: InlineHookHandler, opts: In<HookDefinition> = {}): this {
    if (typeof a === 'string') this.inline.push({ phase: a, handler: handler!, opts });
    else this.spec.hooks = [...(this.spec.hooks ?? []), a];
    return this;
  }
  compensate(action: CompensationAction | (In<CompensationAction> & Pick<CompensationAction, 'name' | 'config'>)): this {
    this.spec.compensate = [...(this.spec.compensate ?? []), action as CompensationAction];
    return this;
  }
  position(x: number, y: number): this {
    this.spec.position = { x, y };
    return this;
  }
  /** Set any stage field directly. */
  set<K extends keyof StageInput>(field: K, value: StageInput[K]): this {
    this.spec[field] = value;
    return this;
  }

  /** @internal */
  toInput(ctx: BuildContext): Record<string, unknown> {
    const hooks = [...(this.spec.hooks ?? [])];
    this.inline.forEach(({ phase, handler, opts }, i) => {
      const handlerName = `script:${ctx.workflowSlug}:${this.key}:${phase}:${i}`;
      ctx.handlers.set(handlerName, handler);
      hooks.push({
        id: opts.id ?? `${this.key}-${phase}-${i}`,
        name: opts.name ?? `${phase} handler`,
        phase,
        type: 'function',
        priority: opts.priority ?? 0,
        enabled: opts.enabled ?? true,
        failurePolicy: opts.failurePolicy ?? 'skip',
        timeoutMs: opts.timeoutMs ?? 30_000,
        retries: opts.retries ?? 0,
        config: { type: 'function', handlerName },
      });
    });
    return {
      key: this.key,
      name: this.spec.name ?? this.key,
      kind: 'agent',
      ...this.spec,
      ...(hooks.length ? { hooks } : {}),
    };
  }
}

export class WorkflowBuilder {
  private readonly spec: Mutable<In<WorkflowSpec>> & { name: string };
  private readonly stages: StageBuilder[] = [];
  private readonly edges: Array<In<EdgeSpec> & Pick<EdgeSpec, 'from' | 'to'>> = [];
  private readonly inline: Array<{ phase: WorkflowHookPhase; handler: InlineHookHandler; opts: In<WorkflowHookDefinition> }> = [];

  constructor(name: string) {
    if (!name) throw new Error('A workflow needs a name');
    this.spec = { name };
  }

  description(text: string): this {
    this.spec.description = text;
    return this;
  }
  tags(tags: string[]): this {
    this.spec.tags = [...tags];
    return this;
  }
  project(projectId: string | null): this {
    this.spec.projectId = projectId;
    return this;
  }
  variable(name: string, def: Omit<In<VariableDefinition>, 'name'> & Pick<VariableDefinition, 'type' | 'label'>): this {
    this.spec.variables = [...(this.spec.variables ?? []), { name, ...def } as VariableDefinition];
    return this;
  }
  /** Merge workflow session settings. */
  session(session: SessionSpec): this {
    this.spec.session = resolveSessionSpec(this.spec.session, session);
    return this;
  }
  model(model: string): this {
    return this.session({ model });
  }
  agent(agentRef: string, overrides?: AgentOverrides): this {
    return this.session({ agentRef, ...(overrides ? { agentOverrides: overrides } : {}) });
  }
  /** Merge lifecycle settings (codebases, worktrees, post-processing flags). */
  lifecycle(lifecycle: In<Omit<Lifecycle, 'postProcessing'>> & { postProcessing?: In<Lifecycle['postProcessing']> }): this {
    const prev = (this.spec.lifecycle ?? {}) as In<Lifecycle>;
    this.spec.lifecycle = {
      ...prev,
      ...lifecycle,
      ...(lifecycle.postProcessing ? { postProcessing: { ...(prev.postProcessing ?? {}), ...lifecycle.postProcessing } } : {}),
    } as Lifecycle;
    return this;
  }
  preprocess(step: In<PreprocessingStep> & Pick<PreprocessingStep, 'name' | 'config'>): this {
    const prev = (this.spec.lifecycle ?? {}) as In<Lifecycle>;
    return this.lifecycle({ preprocessingSteps: [...(prev.preprocessingSteps ?? []), step as PreprocessingStep] });
  }
  postProcess(step: In<PostProcessingStep> & Pick<PostProcessingStep, 'name' | 'config'>): this {
    const prev = (this.spec.lifecycle ?? {}) as In<Lifecycle>;
    return this.lifecycle({ postProcessing: { steps: [...(prev.postProcessing?.steps ?? []), step as PostProcessingStep] } });
  }
  hook(def: WorkflowHookDefinition): this;
  hook(phase: WorkflowHookPhase, handler: InlineHookHandler, opts?: In<WorkflowHookDefinition>): this;
  hook(a: WorkflowHookDefinition | WorkflowHookPhase, handler?: InlineHookHandler, opts: In<WorkflowHookDefinition> = {}): this {
    if (typeof a === 'string') this.inline.push({ phase: a, handler: handler!, opts });
    else this.spec.hooks = [...(this.spec.hooks ?? []), a];
    return this;
  }
  onExit(action: In<ActionDefinition> & { name: string; config: HookConfig }): this {
    this.spec.onExit = [...(this.spec.onExit ?? []), action as ActionDefinition];
    return this;
  }
  onFailure(action: In<ActionDefinition> & { name: string; config: HookConfig }): this {
    this.spec.onFailure = [...(this.spec.onFailure ?? []), action as ActionDefinition];
    return this;
  }
  budget(budget: Budget): this {
    this.spec.budget = { ...this.spec.budget, ...budget };
    return this;
  }
  maxParallel(n: number): this {
    this.spec.maxParallel = n;
    return this;
  }
  output(name: string, expr: string): this {
    this.spec.outputs = { ...(this.spec.outputs ?? {}), [name]: expr };
    return this;
  }
  /** Add a stage; `configure` fills it in. Keys are unique. */
  stage(key: string, configure: (s: StageBuilder) => StageBuilder | void = () => {}): this {
    if (this.stages.some((s) => s.key === key)) throw new Error(`Stage '${key}' is defined twice`);
    const b = new StageBuilder(key);
    configure(b);
    this.stages.push(b);
    return this;
  }
  edge(from: string, to: string, opts: In<Omit<EdgeSpec, 'from' | 'to'>> = {}): this {
    this.edges.push({ from, to, ...opts });
    return this;
  }
  /** Chain stages with success edges: `.chain('plan', 'build', 'test')`. */
  chain(...keys: string[]): this {
    for (let i = 1; i < keys.length; i++) this.edge(keys[i - 1]!, keys[i]!);
    return this;
  }

  private assemble(): { doc: WorkflowGraphInput; handlers: Map<string, InlineHookHandler> } {
    const ctx: BuildContext = { workflowSlug: slug(this.spec.name), handlers: new Map() };
    const hooks = [...(this.spec.hooks ?? [])];
    this.inline.forEach(({ phase, handler, opts }, i) => {
      const handlerName = `script:${ctx.workflowSlug}:workflow:${phase}:${i}`;
      ctx.handlers.set(handlerName, handler);
      hooks.push({
        id: opts.id ?? `workflow-${phase}-${i}`,
        name: opts.name ?? `${phase} handler`,
        phase,
        type: 'function',
        priority: opts.priority ?? 0,
        enabled: opts.enabled ?? true,
        failurePolicy: opts.failurePolicy ?? 'skip',
        timeoutMs: opts.timeoutMs ?? 30_000,
        retries: opts.retries ?? 0,
        config: { type: 'function', handlerName },
      });
    });
    const doc = {
      formatVersion: 2,
      workflow: { ...this.spec, ...(hooks.length ? { hooks } : {}) },
      stages: this.stages.map((s) => s.toInput(ctx)),
      edges: this.edges,
    } as WorkflowGraphInput;
    return { doc, handlers: ctx.handlers };
  }

  /** The authored document, unvalidated. */
  toDocument(): WorkflowGraphInput {
    return this.assemble().doc;
  }

  validate(opts: { engine?: EngineLevel } = {}): ValidationResult {
    return validateWorkflow(this.toDocument(), { engine: opts.engine ?? ENGINE_LEVEL });
  }

  /** Validate and return the parsed graph; throws WorkflowBuildError on any error. */
  build(opts: { engine?: EngineLevel } = {}): WorkflowGraph {
    return this.buildWithHandlers(opts).graph;
  }

  /** Like build(), plus the inline hook handlers keyed by their generated handler names. */
  buildWithHandlers(opts: { engine?: EngineLevel } = {}): { graph: WorkflowGraph; handlers: Map<string, InlineHookHandler> } {
    const { doc, handlers } = this.assemble();
    const r = validateWorkflow(doc, { engine: opts.engine ?? ENGINE_LEVEL });
    if (!r.valid || !r.graph) throw new WorkflowBuildError(r.issues);
    return { graph: r.graph, handlers };
  }
}

/** Start a workflow. */
export function workflow(name: string): WorkflowBuilder {
  return new WorkflowBuilder(name);
}
