// ────────────────────────────────────────────────────────────────
// The prepare phases of `starting` (P04 WP-4.1), in order:
//
//   workspace       the run's execution workspace (managed root: plans,
//                   artifacts, uploads, scratch); `on_run_start` hooks
//   worktrees       the run's mounts through MountService (RV-19): each
//                   selected codebase (the request's, else the lifecycle's
//                   `codebaseAliases`; never "all codebases", W-22) as a
//                   worktree or in place, else one generated directory. The
//                   same shadow stores, checkpoints and Changes as a chat.
//                   `pre_clone` / `post_clone` hooks
//   uploads         files staged before the run (one writer, C-16)
//   projectConfigs  the project's agents, prompts and skills
//   preprocess      the definition's preprocessing steps;
//                   `on_preprocessing_complete` hooks
//   sandbox         the run sandbox when the deployment has one; fails
//                   closed unless `lifecycle.sandbox: 'optional'`;
//                   `on_all_stages_scheduled` hooks
//
// Each is a pure-ish `(ctx, run) => PhaseResult`: it reads the run row and
// answers what to merge into it; `DefaultRunLifecycle` journals it.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatSourceSpec, HookPhaseResult, RunCodebase, WorkflowRun } from '@generatorai/shared';
import type { PreparePhase, WorkflowGraph } from '@generatorai/workflow-spec';
import { branchSlugFor } from '../../MountService.js';
import { runWorkspace } from '../../session/workspaceExposure.js';
import type { PhaseResult, RunLifecycleDeps } from '../RunLifecycle.js';
import { scanRunUploads, writeRunUpload, type UploadCategory } from './runUploads.js';

/** The project configs the `projectConfigs` phase copies into the run (ProjectConfigService). */
export interface ProjectConfigSource {
  listConfigs(projectId: string): Promise<Array<{ id: string; type: string; name: string; filePath: string }>>;
  getConfigContent(configId: string): Promise<string>;
}

export interface PrepareContext {
  deps: RunLifecycleDeps;
  graph: WorkflowGraph;
  now: () => number;
  hooks: (phase: string, run: WorkflowRun) => Promise<HookPhaseResult>;
}

type Phase = (ctx: PrepareContext, run: WorkflowRun) => Promise<PhaseResult>;

/** The codebases a run mounts: its invocation's selection, else the lifecycle's aliases. */
export function codebaseSelectionOf(
  run: Pick<WorkflowRun, 'codebaseSelection'>,
  graph: WorkflowGraph,
): Array<{ alias: string; baseRef?: string; mode: 'worktree' | 'in_place' }> {
  if (run.codebaseSelection) return run.codebaseSelection;
  const mode = graph.workflow.lifecycle.useWorktree ? 'worktree' : 'in_place';
  return graph.workflow.lifecycle.codebaseAliases.map((alias) => ({ alias, mode }));
}

const workspace: Phase = async ({ deps, graph, hooks }, run) => {
  const { workspaceManager } = deps;
  const projectId = run.projectId ?? graph.workflow.projectId ?? undefined;
  let ws = run.workspaceId ? await workspaceManager.getExecutionWorkspace(run.workspaceId) : null;
  if (!ws) {
    // Mount-backed like a chat's (the managed root is scratch; the code
    // lives in mounts), when the mount service is wired.
    const mounted = !!deps.mounts;
    ws = await workspaceManager.createWorkspace({
      ownerType: 'workflow_run',
      ownerId: run.id,
      projectId,
      useWorktree: graph.workflow.lifecycle.useWorktree,
      gitEnabled: !mounted,
      stageSystemArtifacts: true,
      stageProjectArtifacts: !!projectId,
      ...(mounted ? { sources: [] as ChatSourceSpec[] } : {}),
      ...(graph.workflow.session.browser ? { browserConfig: graph.workflow.session.browser as Record<string, unknown> } : {}),
    });
  }
  const artifactsDirectory = path.join(ws.rootPath, 'artifacts');
  const updated: WorkflowRun = {
    ...run,
    workspaceId: ws.id,
    systemVars: { ...(run.systemVars ?? {}), artifactsDirectory, workingDirectory: run.systemVars?.workingDirectory ?? workspaceManager.getWorkingDirectory(ws) },
  };
  const started = await hooks('on_run_start', updated);
  if (!started.shouldContinue) throw new Error(started.mergedResult.abortReason ?? 'The run was aborted by an on_run_start hook');
  return {
    workspaceId: ws.id,
    systemVars: { artifactsDirectory, workingDirectory: updated.systemVars!.workingDirectory! },
    ...(started.mergedResult.variables ? { variables: { ...run.variables, ...userOnly(started.mergedResult.variables) } } : {}),
  };
};

/** Hook-returned variables are user variables: engine-reserved names never enter the bag. */
function userOnly(vars: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(vars).filter(([k]) => !/^(__|repo_path_|repo_branch_)/.test(k)));
}

const worktrees: Phase = async ({ deps, graph, hooks }, run) => {
  const selection = codebaseSelectionOf(run, graph);
  if (selection.length === 0 && graph.workflow.lifecycle.requiresCodebase) {
    throw new Error('This workflow requires at least one codebase, and none was selected');
  }
  const mounts = deps.mounts;
  const ws = await runWorkspace(deps.workspaceManager, run);
  if (!mounts) {
    if (selection.length > 0) throw new Error('Project codebases cannot be mounted in this process (no mount service)');
    return {};
  }
  await hooks('pre_clone', run);
  const projectId = run.projectId ?? graph.workflow.projectId ?? undefined;
  // A resumed phase (or a fork that reuses the workspace) finds its rows staged.
  if ((await mounts.list(ws.id)).length === 0) {
    const sources: ChatSourceSpec[] = selection.map((c) => ({
      kind: 'codebase',
      codebaseId: c.alias,
      alias: c.alias,
      mode: c.mode === 'in_place' ? 'in-place' : 'worktree',
      ...(c.baseRef ? { baseRef: c.baseRef } : {}),
    }));
    const planned = await mounts.plan(ws.rootPath, projectId, sources, { branchSlug: branchSlugFor(run.name, run.id) });
    await mounts.stage(ws.id, planned);
  }
  await mounts.prepare(ws.id);
  await mounts.ready(ws.id);
  const rows = (await mounts.list(ws.id)).filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position);
  const codebases: Record<string, RunCodebase> = {};
  for (const m of rows) {
    if (m.originKind !== 'codebase') continue;
    codebases[m.alias] = { path: m.path, branch: m.git?.branch ?? null, baseRef: m.git?.baseRef ?? null, mountId: m.id };
  }
  const workingDirectory = rows[0]?.path ?? deps.workspaceManager.getWorkingDirectory(ws);
  const updated: WorkflowRun = { ...run, systemVars: { ...(run.systemVars ?? {}), codebases, workingDirectory } };
  await hooks('post_clone', updated);
  return { systemVars: { codebases, workingDirectory }, detail: `${Object.keys(codebases).length} codebase(s)` };
};

const uploads: Phase = async ({ deps }, run) => {
  const staged = run.systemVars?.uploads ?? [];
  const ws = await runWorkspace(deps.workspaceManager, run);
  if (staged.length > 0) {
    if (!deps.uploads) throw new Error('Run uploads are not available in this process');
    for (const u of staged) {
      const record = await deps.uploads.get(u.uploadId);
      if (!record) throw new Error(`Upload ${u.uploadId} no longer exists (uploads expire after an hour)`);
      if (!(await deps.uploads.markConsumed(u.uploadId, run.id))) throw new Error(`Upload ${u.uploadId} was used by another run`);
      const content = await fs.readFile(record.path);
      await writeRunUpload(ws.rootPath, u.category, record.name, content);
      await fs.rm(path.dirname(record.path), { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { systemVars: await scanRunUploads(ws.rootPath), detail: `${staged.length} upload(s)` };
};

const CONFIG_CATEGORY: Record<string, UploadCategory | undefined> = { skill: 'skills', agent: 'agents', prompt: 'prompts' };

const projectConfigs: Phase = async ({ deps, graph }, run) => {
  const projectId = run.projectId ?? graph.workflow.projectId ?? undefined;
  if (!projectId || !deps.projectConfigs) return {};
  const ws = await runWorkspace(deps.workspaceManager, run);
  let wired = 0;
  for (const config of await deps.projectConfigs.listConfigs(projectId)) {
    const category = CONFIG_CATEGORY[config.type];
    if (!category) continue;
    try {
      const content = await deps.projectConfigs.getConfigContent(config.id);
      // Skills and agents are named after the config; prompts keep their file name.
      const name = category === 'prompts' ? path.basename(config.filePath) : `${config.name}.md`;
      await writeRunUpload(ws.rootPath, category, name, content);
      wired += 1;
    } catch (err) {
      deps.logger?.warn(`[RunLifecycle] ${run.id}: project config "${config.name}" was not wired: ${String(err)}`);
    }
  }
  return { systemVars: await scanRunUploads(ws.rootPath), detail: `${wired} project config(s)` };
};

const preprocess: Phase = async ({ deps, graph, hooks }, run) => {
  const steps = graph.workflow.lifecycle.preprocessingSteps;
  if (steps.length === 0) return {};
  if (!deps.steps) throw new Error('Preprocessing steps cannot run in this process');
  const ws = await runWorkspace(deps.workspaceManager, run);
  const ctx = {
    runId: run.id,
    runName: run.name,
    workflowName: graph.workflow.name,
    workspaceId: ws.id,
    workDir: run.systemVars?.workingDirectory ?? deps.workspaceManager.getWorkingDirectory(ws),
    variables: { ...run.variables },
    codebases: { ...(run.systemVars?.codebases ?? {}) },
  };
  const results = await deps.steps.execute(steps, ctx);
  const updated: WorkflowRun = { ...run, variables: ctx.variables, systemVars: { ...(run.systemVars ?? {}), codebases: ctx.codebases } };
  await hooks('on_preprocessing_complete', updated);
  return { variables: ctx.variables, systemVars: { codebases: ctx.codebases, preprocessing: results }, detail: `${results.length} step(s)` };
};

const sandbox: Phase = async (ctx, run) => {
  const result = await startSandbox(ctx, run);
  // The last prepare phase: every root stage is scheduled once `prepared` lands.
  await ctx.hooks('on_all_stages_scheduled', { ...run, systemVars: { ...(run.systemVars ?? {}), ...(result.systemVars ?? {}) } });
  return result;
};

async function startSandbox({ deps, graph }: PrepareContext, run: WorkflowRun): Promise<PhaseResult> {
  const sb = deps.sandbox;
  if (!sb) return {};
  const workDir = run.systemVars?.workingDirectory;
  try {
    const session = await sb.lifecycle.createForRun(run.id, workDir ?? (await runWorkspace(deps.workspaceManager, run)).rootPath);
    await deps.eventBus
      .emitGlobal({
        kind: 'workflow_run.sandbox_created',
        data: { workflowRunId: run.id, sandboxName: session.sandboxName, cliUrl: session.cliUrl ?? 'n/a', isDockerSandbox: session.isDockerSandbox },
      })
      .catch(() => undefined);
    return {
      systemVars: { sandbox: { name: session.sandboxName, ...(session.cliUrl ? { cliUrl: session.cliUrl } : {}), docker: session.isDockerSandbox } },
      detail: session.sandboxName,
    };
  } catch (err) {
    // Fail closed: a run that asked for a sandbox never silently runs on the host.
    if (graph.workflow.lifecycle.sandbox !== 'optional') throw err;
    deps.logger?.warn(`[RunLifecycle] ${run.id}: the sandbox did not start (${String(err)}); lifecycle.sandbox is optional, running on the host`);
    return { detail: 'sandbox skipped (optional)' };
  }
}

/** The prepare phases, in order. */
export const preparePhases: ReadonlyArray<readonly [PreparePhase, Phase]> = [
  ['workspace', workspace],
  ['worktrees', worktrees],
  ['uploads', uploads],
  ['projectConfigs', projectConfigs],
  ['preprocess', preprocess],
  ['sandbox', sandbox],
];
