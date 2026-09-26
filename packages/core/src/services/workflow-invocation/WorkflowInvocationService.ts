// ────────────────────────────────────────────────────────────────
// WorkflowInvocationService — THE way a run comes into existence (P04
// WP-4.2; G4 §1.3.2). Every client and trigger goes through `invoke`: the
// web, desktop and mobile run dialogs, the CLI/TUI, the SDK, the MCP
// server, automations (manual, schedule, webhook), scripts and forks.
//
// invoke(request, ctx):
//   1. parse (zod, strict; `__*` variables refused) and the scope checks
//   2. idempotency claim — the `Idempotency-Key` header, else
//      `body.idempotencyKey`, else a key derived from an in-process trigger
//      (`chat:<chat>:<tool call>`, `stage:<stage run>:<tool call>`,
//      `auto:<execution>:<iteration>:<attempt>`); a replay answers the
//      same run, a replay with another body is a 409 (24 h)
//   3. resolve the target: a definition (drafts only as a user's test
//      run), a script (materialized once per content), a fork of a terminal
//      run (`forkRun`)
//   4. validate (validateInvocation) and plan (planInvocation)
//   5. write the run with typed columns (trigger, lineage, overrides,
//      codebases, system values: never `__*` variables, W-06)
//   6. start it — the engine's `starting` runs the ONE lifecycle
//   7. `workflow_run.invoked`
//
// `waitFor` subscribes BEFORE its fast-path read and returns on
// `workflow_run.finalized` (after post-processing), on an approval when
// asked, on timeout or on abort (W-63). `digest` is the compact state
// waiters and agents read.
// ────────────────────────────────────────────────────────────────

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ILogger, PersistedEvent, StageRun, WorkflowRun } from '@generatorai/shared';
import { ConflictError, NotFoundError, ValidationError } from '@generatorai/shared';
import {
  InvocationRequestSchema,
  type InvocationIssue,
  type InvocationPlan,
  type InvocationRequest,
  type InvocationResult,
  type InvocationTrigger,
  type RunDigest,
  type RunPermissionMode,
  type RunProfile,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { IInvocationUploadRepository, InvocationUploadCategory } from '../../domain/ports/IInvocationStores.js';
import type { IProjectCodebaseRepository } from '../../domain/ports/IProjectCodebaseRepository.js';
import type { IStageRunRepository } from '../../domain/ports/IStageRunRepository.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import type { EventBus } from '../../events/EventBus.js';
import { getDefaultChatPermissionMode } from '../agentModePolicy.js';
import { canonicalGraph } from '../definitions/canonical.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import { safeUploadName, UPLOAD_EXTENSIONS } from '../engine/lifecycle/runUploads.js';
import { IdempotencyKeyReusedError, INVOCATION_IDEMPOTENCY_TTL_MS, type IdempotencyService } from '../IdempotencyService.js';
import type { WorkflowDefinitionService } from '../WorkflowDefinitionService.js';
import { RunCommandRefusedError, type WorkflowRunService } from '../WorkflowRunService.js';
import type { WorkflowApprovalService } from '../WorkflowApprovalService.js';
import { outputDrift } from '../engine/SubworkflowEffects.js';
import { planInvocation } from './planInvocation.js';
import { InvocationError, issue, type InvocationContext } from './types.js';
import { checkInvocationScopes, validateInvocation, type ValidatedInvocation } from './validateInvocation.js';

/** A workflow script the invocation can run (the server's / SDK's script loader). */
export interface InvocationScriptSource {
  getScript(id: string): { graph: WorkflowGraph; profiles: RunProfile[] } | undefined;
}

export interface WorkflowInvocationDeps {
  runs: WorkflowRunService;
  runRepo: IWorkflowRunRepository;
  stageRuns: IStageRunRepository;
  definitions: WorkflowDefinitionService;
  versions: RunDefinitionReader;
  eventBus: EventBus;
  idempotency?: IdempotencyService | undefined;
  uploads?: IInvocationUploadRepository | undefined;
  /** Where staged uploads live until a run consumes them. */
  uploadsDir?: string | undefined;
  codebases?: IProjectCodebaseRepository | undefined;
  scripts?: InvocationScriptSource | undefined;
  models?: (() => Promise<Array<{ id: string }>>) | undefined;
  /** The deployment runs stages in a sandbox (the plan lists the `sandbox` phase). */
  sandboxEnabled?: boolean | undefined;
  /** The web app origin, for result links. */
  appUrl?: string | undefined;
  /** Pending decisions, sub-workflow children's mirrored (P05). */
  approvals?: WorkflowApprovalService | undefined;
  logger?: ILogger | undefined;
  now?: () => number;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const UPLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** A target resolved for validation and planning. */
interface ResolvedTarget {
  workflowDefinitionId: string;
  definitionVersionId: string | null;
  graph: WorkflowGraph;
  profile?: RunProfile | undefined;
  fork?: WorkflowRun | undefined;
  script?: { id: string; graph: WorkflowGraph; hash: string } | undefined;
}

export class WorkflowInvocationService {
  private readonly now: () => number;
  /** Script content hash → the definition it was materialized as (this process). */
  private readonly scriptDefinitions = new Map<string, string>();

  constructor(private readonly deps: WorkflowInvocationDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Late wiring: the script loader is built after the core services. */
  setScripts(scripts: InvocationScriptSource): void {
    this.deps.scripts = scripts;
  }

  // ── invoke ───────────────────────────────────────────────────

  /** Start a run. Throws `InvocationError` (one code, the issues behind it). */
  async invoke(raw: unknown, ctx: InvocationContext): Promise<InvocationResult> {
    const req = parseRequest(raw);
    checkInvocationScopes(req, ctx);
    const key = ctx.idempotencyKey ?? req.idempotencyKey ?? derivedKey(ctx);
    if (!key || !this.deps.idempotency) return this.execute(req, ctx, key);
    try {
      const outcome = await this.deps.idempotency.run(
        { key, scope: `invoke:${ctx.principal.id}`, ttlMs: INVOCATION_IDEMPOTENCY_TTL_MS, requestHash: requestHash(req) },
        async () => {
          const result = await this.execute(req, ctx, key);
          return { executionId: result.runId, value: result };
        },
      );
      if (!outcome.replayed) return outcome.value;
      return this.resultFor(await this.deps.runRepo.getById(outcome.executionId), true);
    } catch (err) {
      if (err instanceof IdempotencyKeyReusedError) throw new InvocationError('IDEMPOTENCY_KEY_REUSED', err.message);
      if (err instanceof InvocationError) throw err;
      if (err instanceof ValidationError) throw new InvocationError('VALIDATION_ERROR', err.message, [issue('idempotency-key', ['idempotencyKey'], err.message)]);
      if (err instanceof ConflictError) throw new InvocationError('CONFLICT', err.message);
      throw err;
    }
  }

  /** What `invoke` would do: the same resolution and validation, nothing written (a script is not materialized). */
  async plan(raw: unknown, ctx: InvocationContext): Promise<InvocationPlan> {
    const req = parseRequest(raw);
    checkInvocationScopes(req, ctx);
    const target = await this.resolve(req, ctx, { materialize: false });
    const v = await this.validate(req, ctx, target);
    return this.planOf(target, v);
  }

  private async execute(req: InvocationRequest, ctx: InvocationContext, key: string | undefined): Promise<InvocationResult> {
    const target = await this.resolve(req, ctx, { materialize: true });
    const v = await this.validate(req, ctx, target);
    const invocationId = randomUUID();
    const trigger: InvocationTrigger =
      req.target.kind === 'fork' ? { kind: 'fork', sourceRunId: req.target.sourceRunId, principalId: ctx.principal.id } : ctx.trigger;
    const runKey = key ? `invoke:${ctx.principal.id}:${key}` : undefined;

    let run: WorkflowRun;
    if (req.target.kind === 'fork') {
      if (v.uploads.length > 0) throw new InvocationError('VALIDATION_ERROR', 'A fork runs with its source run\'s files; uploads are not taken', [issue('fork-uploads', ['uploads'], 'not taken for a fork')]);
      run = await this.deps.runs
        .forkRun(
          req.target.sourceRunId,
          {
            ...(req.target.rerunFrom ? { rerunFrom: req.target.rerunFrom } : {}),
            definition: req.target.definition,
            workspace: req.target.workspace,
            ...(Object.keys(req.variables).length > 0 ? { variablesOverride: req.variables } : {}),
            start: false,
          },
          { trigger, invocationId, ...(v.name ? { name: v.name } : {}) },
        )
        .catch((err: unknown) => {
          throw toInvocationError(err);
        });
      if (v.permissionMode) await this.deps.runs.setPermissionMode(run.id, v.permissionMode);
    } else {
      run = await this.deps.runs.createRun({
        workflowDefinitionId: target.workflowDefinitionId,
        definitionVersionId: target.definitionVersionId!,
        ...(v.name ? { name: v.name } : {}),
        variables: v.variables,
        trigger,
        invocationId,
        ...(runKey ? { idempotencyKey: runKey } : {}),
        ...(v.projectId ? { projectId: v.projectId } : {}),
        ...(v.permissionMode ? { permissionMode: v.permissionMode } : {}),
        runOverrides: v.runOverrides,
        stageOverrides: v.stageOverrides,
        codebaseSelection: v.codebases,
        systemVars: {
          ...(v.permissionCeiling ? { triggerPermissionMode: v.permissionCeiling } : {}),
          ...(v.uploads.length > 0 ? { uploads: v.uploads } : {}),
          ...(ctx.inheritWorkspace ? { inheritedWorkspace: ctx.inheritWorkspace } : {}),
        },
        ...(ctx.inheritWorkspace ? { workspaceId: ctx.inheritWorkspace.workspaceId } : {}),
        ...(v.budget ? { budget: v.budget } : {}),
        ...(v.lineage.parentRunId ? { parentRunId: v.lineage.parentRunId } : {}),
        ...(v.lineage.parentStageRunId ? { parentStageRunId: v.lineage.parentStageRunId } : {}),
        ...(v.lineage.rootRunId ? { rootRunId: v.lineage.rootRunId } : {}),
        depth: v.lineage.depth,
      });
    }

    try {
      await this.deps.runs.startRun(run.id);
    } catch (err) {
      // A run that cannot start is not left behind as `created`.
      await this.deps.runs.deleteRun(run.id).catch(() => undefined);
      throw toInvocationError(err);
    }
    await this.deps.eventBus
      .emitGlobal({ kind: 'workflow_run.invoked', data: { workflowRunId: run.id, invocationId, trigger } } as never)
      .catch(() => undefined);
    this.deps.logger?.info?.(`[Invocation] ${trigger.kind} started run ${run.id} of ${run.workflowDefinitionId}`);
    const plan = this.planOf({ ...target, definitionVersionId: run.definitionVersionId }, v);
    return {
      invocationId,
      runId: run.id,
      workflowDefinitionId: run.workflowDefinitionId,
      status: 'starting',
      replayed: false,
      trigger,
      links: this.links(run),
      plan,
      warnings: plan.warnings,
    };
  }

  private planOf(target: ResolvedTarget, v: ValidatedInvocation): InvocationPlan {
    return planInvocation(target, v, { sandbox: this.deps.sandboxEnabled === true, projectConfigs: true });
  }

  private links(run: Pick<WorkflowRun, 'id' | 'workflowDefinitionId'>): InvocationResult['links'] {
    const app = `${this.deps.appUrl ?? ''}/workflows/${run.workflowDefinitionId}/runs/${run.id}`;
    return { app, api: `/api/workflow-runs/${run.id}`, stream: `/api/stream?scope=run&id=${run.id}` };
  }

  /** The result of an invocation that already ran (an idempotent replay). */
  private async resultFor(run: WorkflowRun, replayed: boolean): Promise<InvocationResult> {
    const graph = await this.deps.versions.get(run.definitionVersionId);
    const v: ValidatedInvocation = {
      variables: run.variables,
      ...(run.projectId ? { projectId: run.projectId } : {}),
      codebases: run.codebaseSelection ?? [],
      codebaseSource: 'request',
      stageOverrides: run.stageOverrides ?? [],
      runOverrides: run.runOverrides ?? {},
      effectivePermissionMode: (run.effectivePermissionMode ?? getDefaultChatPermissionMode()) as RunPermissionMode,
      lineage: {
        depth: run.depth ?? 0,
        ...(run.rootRunId ? { rootRunId: run.rootRunId } : {}),
        ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      },
      uploads: run.systemVars?.uploads ?? [],
      warnings: [],
    };
    const trigger = (run.trigger ?? { kind: 'user', client: 'unknown', principalId: 'unknown' }) as InvocationTrigger;
    return {
      invocationId: run.invocationId ?? run.id,
      runId: run.id,
      workflowDefinitionId: run.workflowDefinitionId,
      status: run.status === 'created' ? 'created' : 'starting',
      replayed,
      trigger,
      links: this.links(run),
      plan: this.planOf({ workflowDefinitionId: run.workflowDefinitionId, definitionVersionId: run.definitionVersionId, graph }, v),
      warnings: [],
    };
  }

  // ── resolution ───────────────────────────────────────────────

  private async resolve(req: InvocationRequest, ctx: InvocationContext, opts: { materialize: boolean }): Promise<ResolvedTarget> {
    const t = req.target;
    try {
      if (t.kind === 'definition') {
        const record = await this.deps.definitions.get(t.workflowDefinitionId);
        const testRun = t.testRun === true;
        if (testRun && !isPersonPrincipal(ctx)) {
          throw new InvocationError('DRAFT_NOT_RUNNABLE', 'Only a person can start a test run', [issue('test-run', ['target', 'testRun'], 'user principals only')]);
        }
        if (record.status === 'draft' && !testRun) {
          throw new InvocationError('DRAFT_NOT_RUNNABLE', `Workflow '${record.graph.workflow.name}' is a draft: publish it, or start a test run`, [
            issue('draft', ['target', 'workflowDefinitionId'], 'the definition is a draft'),
          ]);
        }
        let versionId: string;
        if (t.version !== undefined && !testRun) {
          const version = (await this.deps.definitions.listVersions(t.workflowDefinitionId)).find((x) => x.kind === 'published' && x.version === t.version);
          if (!version) throw new InvocationError('NOT_FOUND', `Published version ${t.version} does not exist`, [issue('unknown-version', ['target', 'version'], 'no such version')]);
          versionId = version.id;
        } else {
          versionId = await this.deps.definitions.resolveVersionForRun(t.workflowDefinitionId, { testRun });
        }
        return { workflowDefinitionId: t.workflowDefinitionId, definitionVersionId: versionId, graph: await this.deps.versions.get(versionId) };
      }

      if (t.kind === 'script') {
        const script = this.deps.scripts?.getScript(t.scriptId);
        if (!script) throw new InvocationError('NOT_FOUND', `Script not found: ${t.scriptId}`, [issue('unknown-script', ['target', 'scriptId'], 'no such script')]);
        let profile: RunProfile | undefined;
        if (req.profile) {
          profile = script.profiles.find((p) => p.name === req.profile);
          if (!profile) throw new InvocationError('VALIDATION_ERROR', `Profile not found: ${req.profile}`, [issue('unknown-profile', ['profile'], 'no such profile')]);
        }
        const projectId = req.projectId ?? profile?.projectId;
        const graph = scriptGraph(t.scriptId, script.graph, projectId);
        const hash = canonicalGraph(graph).hash.slice(0, 16);
        if (!opts.materialize) {
          const existing = this.scriptDefinitions.get(hash) ?? (await this.findScriptDefinition(hash));
          return { workflowDefinitionId: existing ?? `script:${t.scriptId}`, definitionVersionId: null, graph, profile, script: { id: t.scriptId, graph, hash } };
        }
        const definitionId = await this.materializeScript(graph, hash);
        const versionId = await this.deps.definitions.resolveVersionForRun(definitionId);
        return { workflowDefinitionId: definitionId, definitionVersionId: versionId, graph: await this.deps.versions.get(versionId), profile, script: { id: t.scriptId, graph, hash } };
      }

      if (req.profile) throw new InvocationError('VALIDATION_ERROR', 'A profile applies to a script target only', [issue('profile-target', ['profile'], 'script targets only')]);
      const source = await this.deps.runRepo.getById(t.sourceRunId);
      if (!TERMINAL.has(source.status)) {
        throw new InvocationError('CONFLICT', `Run ${source.id} is ${source.status}: only a terminal run is forked (a live run takes run commands)`);
      }
      const versionId =
        t.definition === 'latest' ? await this.deps.definitions.resolveVersionForRun(source.workflowDefinitionId) : source.definitionVersionId;
      return { workflowDefinitionId: source.workflowDefinitionId, definitionVersionId: versionId, graph: await this.deps.versions.get(versionId), fork: source };
    } catch (err) {
      throw toInvocationError(err);
    }
  }

  /** Materialize a script's graph once per content: a published definition tagged with the content hash. */
  private async materializeScript(graph: WorkflowGraph, hash: string): Promise<string> {
    const known = this.scriptDefinitions.get(hash) ?? (await this.findScriptDefinition(hash));
    if (known) {
      this.scriptDefinitions.set(hash, known);
      return known;
    }
    const tagged = { ...graph, workflow: { ...graph.workflow, tags: [...new Set([...graph.workflow.tags, `script-hash:${hash}`])].slice(0, 20) } };
    const record = await this.deps.definitions.createFromSpec(tagged, { canEditCommands: true, status: 'published' });
    this.scriptDefinitions.set(hash, record.id);
    return record.id;
  }

  private async findScriptDefinition(hash: string): Promise<string | undefined> {
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const res = await this.deps.definitions.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      const hit = res.items.find((d) => d.status === 'published' && d.tags.includes(`script-hash:${hash}`));
      if (hit) return hit.id;
      if (!res.nextCursor) return undefined;
      cursor = res.nextCursor;
    }
    return undefined;
  }

  private validate(req: InvocationRequest, ctx: InvocationContext, target: ResolvedTarget): Promise<ValidatedInvocation> {
    return validateInvocation(req, ctx, target, {
      codebases: this.deps.codebases,
      uploads: this.deps.uploads,
      models: this.deps.models,
      permissionGating: (run, graph) => this.deps.runs.assertPermissionGating(run, graph),
      posture: () => getDefaultChatPermissionMode() as RunPermissionMode,
      subworkflows: (graph, projectId) => this.subworkflowIssues(graph, projectId),
      now: this.now,
    });
  }

  /**
   * P05 §4.2 at invoke: every sub-workflow's child resolves, is published
   * (a draft is refused), and its current outputs still fit this graph's
   * expressions (`subworkflow-output-drift`). The version pinned at the
   * stage's start is checked again then.
   */
  private async subworkflowIssues(graph: WorkflowGraph, projectId: string | null): Promise<InvocationIssue[]> {
    const out: InvocationIssue[] = [];
    for (const [i, s] of graph.stages.entries()) {
      if (s.kind !== 'subworkflow') continue;
      const ref = s.subworkflow.workflowRef;
      const label = 'id' in ref ? `id '${ref.id}'` : `'${ref.name}'`;
      const path = ['target', 'stages', i, 'subworkflow', 'workflowRef'];
      const child = await this.deps.definitions.findByRef(ref, projectId);
      if (!child || child.archivedAt) {
        out.push(issue('subworkflow-ref', path, `Stage "${s.key}": ${child ? `the workflow ${label} is archived` : `no workflow ${label} exists`}`));
        continue;
      }
      if (child.status !== 'published' || !child.currentVersionId) {
        out.push(issue('subworkflow-draft', path, `Stage "${s.key}": the workflow ${label} is a draft; publish it first`));
        continue;
      }
      const childGraph = await this.deps.versions.get(child.currentVersionId);
      const drift = outputDrift(graph, ref, { id: child.id, name: child.graph.workflow.name, graph: childGraph, projectId: childGraph.workflow.projectId ?? null });
      if (drift.length > 0) out.push(issue('subworkflow-output-drift', path, `Stage "${s.key}": the outputs of ${label} no longer fit: ${drift.join('; ')}`));
    }
    return out;
  }

  // ── uploads ──────────────────────────────────────────────────

  /**
   * Stage files for a run that has not started yet (TTL 1 h). The run's
   * `uploads` phase consumes them; a file is used by one run only.
   */
  async stageUploads(
    files: ReadonlyArray<{ category: InvocationUploadCategory; name: string; data: Uint8Array }>,
    principalId: string | null,
  ): Promise<Array<{ uploadId: string; category: InvocationUploadCategory; name: string }>> {
    const { uploads, uploadsDir } = this.deps;
    if (!uploads || !uploadsDir) throw new InvocationError('VALIDATION_ERROR', 'Uploads are not available in this process');
    const out: Array<{ uploadId: string; category: InvocationUploadCategory; name: string }> = [];
    for (const [i, file] of files.entries()) {
      let name: string;
      try {
        name = safeUploadName(file.name);
      } catch (err) {
        throw new InvocationError('VALIDATION_ERROR', String((err as Error).message), [issue('upload-name', ['files', i], 'unusable file name')]);
      }
      const ext = path.extname(name).toLowerCase();
      if (ext && !UPLOAD_EXTENSIONS.has(ext)) {
        throw new InvocationError('VALIDATION_ERROR', `"${file.name}": ${ext} files cannot be uploaded to a run`, [issue('upload-extension', ['files', i], ext)]);
      }
      if (file.data.byteLength > MAX_UPLOAD_BYTES) {
        throw new InvocationError('VALIDATION_ERROR', `"${file.name}" is larger than 10 MB`, [issue('upload-size', ['files', i], 'too large')]);
      }
      const uploadId = randomUUID();
      const dir = path.join(uploadsDir, uploadId);
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, name);
      await fs.writeFile(target, file.data);
      const now = this.now();
      await uploads.create({
        id: uploadId,
        category: file.category,
        name,
        path: target,
        sizeBytes: file.data.byteLength,
        principalId,
        createdAt: new Date(now),
        expiresAt: new Date(now + UPLOAD_TTL_MS),
        consumedByRunId: null,
      });
      out.push({ uploadId, category: file.category, name });
    }
    return out;
  }

  /** Remove staged uploads no run took within their TTL. */
  async sweepUploads(): Promise<number> {
    const { uploads } = this.deps;
    if (!uploads) return 0;
    const expired = await uploads.listExpired(new Date(this.now()));
    for (const u of expired) {
      await fs.rm(path.dirname(u.path), { recursive: true, force: true }).catch(() => undefined);
      await uploads.delete(u.id);
    }
    return expired.length;
  }

  // ── digest and waitFor ───────────────────────────────────────

  /** The run's compact state: status, stages, pending approvals, post-processing. */
  async digest(runId: string, opts: { detail?: 'brief' | 'full' } = {}): Promise<RunDigest> {
    let run: WorkflowRun;
    try {
      run = await this.deps.runRepo.getById(runId);
    } catch (err) {
      throw toInvocationError(err);
    }
    const stages = await this.deps.stageRuns.getByRunId(runId);
    const full = opts.detail === 'full';
    return {
      runId: run.id,
      workflowDefinitionId: run.workflowDefinitionId,
      name: run.name,
      status: run.status,
      statusReason: run.statusReason ?? null,
      outcome: run.outcome ?? null,
      finalized: TERMINAL.has(run.status),
      error: run.error ?? null,
      stages: stages.map((s: StageRun) => ({
        instanceId: s.id,
        key: s.stageKey,
        instancePath: s.instancePath,
        name: s.name,
        status: s.status,
        statusReason: s.statusReason ?? null,
        ...(s.summary ? { summary: s.summary } : {}),
        ...(full ? { output: s.outputData ?? s.outputText ?? null } : {}),
        ...(s.error ? { error: s.error } : {}),
      })),
      pendingApprovals: this.deps.approvals
        ? (await this.deps.approvals.listPending(runId)).map((d) => ({
            instanceId: d.instanceId,
            key: d.stageKey,
            name: d.name,
            kind: d.kind,
            ...(d.runId !== runId ? { runId: d.runId } : {}),
          }))
        : stages.filter((s) => s.status === 'awaiting_input').map((s) => ({ instanceId: s.id, key: s.stageKey, name: s.name })),
      postProcessing: (run.systemVars?.postProcessing ?? []).map((r) => ({
        step: r.stepName,
        success: r.success,
        ...(r.output ? { output: r.output } : {}),
        ...(r.error ? { error: r.error } : {}),
      })),
    };
  }

  /**
   * Wait for the run to finalize (post-processing done), or for an approval
   * when `stopOnApproval`, or until the timeout or the signal. Subscribes
   * FIRST, then reads, so a terminal event between the two is never missed.
   */
  async waitFor(runId: string, opts: { timeoutMs: number; stopOnApproval?: boolean; signal?: AbortSignal }): Promise<RunDigest> {
    let wake: (why: NonNullable<RunDigest['waited']>) => void = () => undefined;
    const woken = new Promise<NonNullable<RunDigest['waited']>>((resolve) => {
      wake = resolve;
    });
    const unsubscribe = this.deps.eventBus.subscribeGlobal((event: PersistedEvent) => {
      const data = event.data as Record<string, unknown> | undefined;
      if (data?.['workflowRunId'] !== runId) return;
      if (event.kind === 'workflow_run.finalized') wake('finalized');
      else if (opts.stopOnApproval && (event.kind === 'stage_run.awaiting_input' || event.kind === 'stage_run.waiting')) wake('approval');
    });
    const timer = setTimeout(() => wake('timeout'), Math.max(0, opts.timeoutMs));
    const onAbort = () => wake('aborted');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const first = await this.digest(runId);
      if (first.finalized) return { ...first, waited: 'finalized' };
      if (opts.stopOnApproval && first.pendingApprovals.length > 0) return { ...first, waited: 'approval' };
      if (opts.signal?.aborted) return { ...first, waited: 'aborted' };
      const why = await woken;
      return { ...(await this.digest(runId)), waited: why };
    } finally {
      unsubscribe();
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────

function parseRequest(raw: unknown): InvocationRequest {
  const parsed = InvocationRequestSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => issue(String((i as { params?: { code?: string } }).params?.code ?? i.code), i.path, i.message));
  throw new InvocationError('VALIDATION_ERROR', `Invalid invocation request: ${issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, issues);
}

/** A person started it (a paired device or the local owner): the only principals that may test-run a draft. */
function isPersonPrincipal(ctx: InvocationContext): boolean {
  return ctx.principal.kind === 'device' || ctx.principal.kind === 'local';
}

/** The key an in-process caller that may retry gets without asking (G4 §1.3.5). */
function derivedKey(ctx: InvocationContext): string | undefined {
  const t = ctx.trigger;
  if (t.kind === 'chat' && t.toolCallId) return `chat:${t.chatId}:${t.toolCallId}`;
  if (t.kind === 'stage' && t.toolCallId) return `stage:${t.stageRunId}:${t.toolCallId}`;
  if (t.kind === 'automation') return `auto:${t.executionId}:${t.iterationIndex ?? 0}:${ctx.attempt ?? 1}`;
  return undefined;
}

/** A stable hash of what the request asks for (the key and the client label are not part of it). */
function requestHash(req: InvocationRequest): string {
  const rest = Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'idempotencyKey' && k !== 'client'));
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
        : v;
  return createHash('sha256').update(JSON.stringify(stable(rest))).digest('hex');
}

/** A script's graph as the definition it materializes to. */
function scriptGraph(id: string, graph: WorkflowGraph, projectId: string | undefined): WorkflowGraph {
  return {
    ...graph,
    workflow: {
      ...graph.workflow,
      ...(projectId ? { projectId } : {}),
      tags: [...new Set([...graph.workflow.tags, `script:${id}`])].slice(0, 20),
    },
  };
}

function toInvocationError(err: unknown): unknown {
  if (err instanceof InvocationError) return err;
  if (err instanceof NotFoundError) return new InvocationError('NOT_FOUND', err.message);
  if (err instanceof RunCommandRefusedError) {
    return new InvocationError(err.result.code === 'engine_unavailable' ? 'ENGINE_UNAVAILABLE' : 'CONFLICT', err.message);
  }
  if (err instanceof ConflictError) return new InvocationError('CONFLICT', err.message);
  if (err instanceof ValidationError) return new InvocationError('VALIDATION_ERROR', err.message);
  const code = (err as { code?: string } | null)?.code;
  if (code === 'PERMISSION_GATING_UNSUPPORTED') return new InvocationError('PERMISSION_GATING_UNSUPPORTED', (err as Error).message);
  return err;
}
