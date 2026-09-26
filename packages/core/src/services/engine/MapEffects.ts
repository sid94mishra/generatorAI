// ────────────────────────────────────────────────────────────────
// MapEffects — the effects of a `mount_per_item` map (P05 §4.1).
//
//   snapshot      take the map's SHARED lease on every run mount
//                 (`worktree:<mountId>`: writers outside the map wait),
//                 then snapshot each mount into a commit — the working tree
//                 as it is, uncommitted upstream changes included (`git add
//                 -A` into a private index, `write-tree`, `commit-tree` on
//                 HEAD, kept alive by `refs/generatorai/maps/<run>/<map>/…`).
//                 A mount that is not git backed fails the map.
//   prepareItem   a workspace per item whose mounts are worktrees on new
//                 branches cut from the snapshot, ALL OR NOTHING
//                 (`MountService.forkFromSnapshot`), then the map's
//                 `itemSetup` checks in the item mount (a failure or a
//                 non-zero exit fails the item: item_setup_failed).
//   mergeItem     sequential: under the EXCLUSIVE lease, a 3-way merge per
//                 mount (base = the snapshot, ours = the run mount as it is
//                 now, theirs = the item) computed for every mount first;
//                 any conflict fails the item (merge_conflict) with nothing
//                 applied and its mount kept; otherwise each run mount is
//                 moved to its merged tree (a two-way read-tree, only the
//                 changed paths), and the item mounts are released.
//                 pr_per_item: the item branch is committed and — following
//                 lifecycle.postProcessing.autoPush / autoCreatePR — pushed
//                 and a PR opened, through the one source-control flow.
//   release       the map's leases (map settled, cancelled or failed).
//
// Every effect answers with a message and never throws; a re-dispatch after
// a crash (RunSupervisor.recover) repeats idempotent steps.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import type { ILogger, RunCodebase, WorkflowRun, WorkspaceMount } from '@generatorai/shared';
import type { CheckStage, Lifecycle, PostProcessingStep } from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { IWorkflowRunRepository } from '../../domain/ports/IWorkflowRunRepository.js';
import { mapItemScope, mapStateOf, StateIndex } from '../../domain/scheduler/scope.js';
import type { InstanceState, MapItemState, MapState, RunState } from '../../domain/scheduler/types.js';
import { compile, type CompiledNode } from '../../domain/workflow-graph/compile.js';
import type { RunDefinitionReader } from '../definitions/RunDefinitionReader.js';
import type { MountService } from '../MountService.js';
import { runWorkspace } from '../session/workspaceExposure.js';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { runCheck } from './CheckRunner.js';
import type { LifecycleSteps } from './lifecycle/steps.js';
import { worktreeLeaseKey, type WorktreeLeases } from './WorktreeLeases.js';

export interface MapEffectsDeps {
  stores: EngineStores;
  runRepo: IWorkflowRunRepository;
  definitions: RunDefinitionReader;
  workspaceManager: WorkspaceManager;
  leases: WorktreeLeases;
  /** The mount service and the post-processing steps (the lifecycle platform; late-wired). */
  platform: () => { mounts?: MountService | undefined; steps?: LifecycleSteps | undefined };
  scriptRunner?: IScriptRunner | undefined;
  logger?: ILogger | undefined;
}

export type PrepareItemResult =
  | { ok: true; workspaceId: string; mounts: Record<string, string>; primaryDir: string; branch: string | null }
  | { ok: false; code: string; error: string; workspaceId?: string; mounts?: Record<string, string>; primaryDir?: string; branch?: string | null };

export type MergeItemResult = { ok: true; pr?: { url: string | null; branch: string } | null } | { ok: false; code: string; error: string; pr?: { url: string | null; branch: string } | null };

interface MapContext {
  run: WorkflowRun;
  inst: InstanceState;
  state: MapState;
  item: MapItemState | undefined;
  node: CompiledNode;
  graphName: string;
  lifecycle: Lifecycle;
}

const refSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');

export class MapEffects {
  constructor(private readonly deps: MapEffectsDeps) {}

  private get mounts(): MountService | undefined {
    return this.deps.platform().mounts;
  }

  private async context(runId: string, stageRunId: string, index?: number): Promise<MapContext> {
    const run = await this.deps.runRepo.getById(runId);
    const graph = await this.deps.definitions.get(run.definitionVersionId);
    const runState = this.deps.stores.runStore.loadRunState(runId);
    const inst = runState?.instances.find((i) => i.id === stageRunId);
    const state = inst ? mapStateOf(inst) : null;
    const node = inst ? compile(graph).nodes.get(inst.stageKey) : undefined;
    if (!inst || !state || !node?.map) throw new Error(`Instance ${stageRunId} is not a map of run ${runId}`);
    return { run, inst, state, item: index !== undefined ? state.items[index] : undefined, node, graphName: graph.workflow.name, lifecycle: graph.workflow.lifecycle };
  }

  /** The run's mounts, in position order. */
  private async runMounts(run: WorkflowRun): Promise<{ workspaceRoot: string; mounts: WorkspaceMount[] }> {
    const svc = this.mounts;
    if (!svc) throw new Error('Mounts are not available in this process (no mount service)');
    const ws = await runWorkspace(this.deps.workspaceManager, run);
    const mounts = (await svc.list(ws.id)).filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position);
    return { workspaceRoot: ws.rootPath, mounts };
  }

  /** The run-mount lease keys of a run (for writers outside a map, and the map's own leases). */
  async leaseKeys(runId: string): Promise<string[]> {
    try {
      const run = await this.deps.runRepo.getById(runId);
      return (await this.runMounts(run)).mounts.map((m) => worktreeLeaseKey(m.id));
    } catch {
      return [];
    }
  }

  // ── snapshot ──────────────────────────────────────────────────

  async snapshot(runId: string, stageRunId: string): Promise<{ snapshot: Record<string, string> | null; error?: string }> {
    let release: (() => void) | undefined;
    try {
      const { run } = await this.context(runId, stageRunId);
      const { workspaceRoot, mounts } = await this.runMounts(run);
      if (mounts.length === 0) return { snapshot: null, error: 'the run has no mounts' };
      release = await this.deps.leases.acquire(mounts.map((m) => worktreeLeaseKey(m.id)), 'shared', stageRunId);
      const git = this.mounts!.git;
      const out: Record<string, string> = {};
      for (const m of mounts) {
        if (!m.git?.isRepo) throw new Error(`mount "${m.alias}" is not a git repository: mount_per_item needs git-backed run mounts`);
        const index = path.join(workspaceRoot, '.generatorai', 'map-index', `${stageRunId}-${refSafe(m.alias)}.run`);
        const tree = await git.writeTreeFromWorktree(m.path, index, { honourEol: true });
        if (!tree) throw new Error(`mount "${m.alias}" could not be snapshotted`);
        const head = await git.revParse(m.path, 'HEAD');
        const sha = await git.commitTree(m.path, tree, `GeneratorAI map snapshot (run ${runId}, ${stageRunId})`, head ?? undefined);
        await git.updateRef(m.path, `refs/generatorai/maps/${refSafe(runId)}/${refSafe(stageRunId)}/${refSafe(m.alias)}`, sha);
        out[m.alias] = sha;
      }
      return { snapshot: out };
    } catch (err) {
      release?.();
      const error = err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn(`[MapEffects] snapshot of ${stageRunId} failed: ${error}`);
      return { snapshot: null, error };
    }
  }

  /** Re-take a running map's shared leases (recovery: leases are process-local). */
  async reacquire(runId: string, stageRunId: string): Promise<void> {
    const keys = await this.leaseKeys(runId);
    await this.deps.leases.acquire(keys, 'shared', stageRunId);
  }

  release(stageRunId: string): void {
    this.deps.leases.release(stageRunId);
  }

  // ── items ─────────────────────────────────────────────────────

  async prepareItem(runId: string, stageRunId: string, index: number): Promise<PrepareItemResult> {
    let ctx: MapContext;
    try {
      ctx = await this.context(runId, stageRunId, index);
    } catch (err) {
      return { ok: false, code: 'mount_fork_failed', error: err instanceof Error ? err.message : String(err) };
    }
    const { run, inst, state, item, node } = ctx;
    const svc = this.mounts;
    if (!item || !state.snapshot || !svc) return { ok: false, code: 'mount_fork_failed', error: 'The map has no snapshot to cut item mounts from' };
    const runWs = await runWorkspace(this.deps.workspaceManager, run);
    const ownerId = `${run.id}~${inst.id.slice(0, 8)}-${index}`;
    let where: Omit<Extract<PrepareItemResult, { ok: true }>, 'ok'>;
    try {
      const existing = item.workspaceId ? await this.deps.workspaceManager.getExecutionWorkspace(item.workspaceId) : null;
      const ws =
        existing ??
        (await this.deps.workspaceManager.createWorkspace({
          ownerType: 'workflow_run',
          ownerId,
          ...(run.projectId ? { projectId: run.projectId } : {}),
          gitEnabled: false,
          sources: [],
        }));
      let rows = (await svc.list(ws.id)).filter((m) => m.status === 'ready');
      if (rows.length === 0) {
        const aliases = Object.keys(state.snapshot);
        const branch = (alias: string) =>
          `generatorai/${run.id.slice(0, 8)}-${inst.stageKey}-${index}${aliases.length > 1 ? `-${refSafe(alias)}` : ''}`;
        try {
          rows = await svc.forkFromSnapshot(runWs.id, state.snapshot, ws, { branchFor: branch });
        } catch (err) {
          await this.deps.workspaceManager.deleteWorkspace(ws.id).catch(() => undefined);
          return { ok: false, code: 'mount_fork_failed', error: `The item's mounts could not be cut from the snapshot: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      where = {
        workspaceId: ws.id,
        mounts: Object.fromEntries(rows.map((m) => [m.alias, m.path])),
        primaryDir: rows[0]!.path,
        branch: rows[0]!.git?.branch ?? null,
      };
    } catch (err) {
      return { ok: false, code: 'mount_fork_failed', error: err instanceof Error ? err.message : String(err) };
    }

    // itemSetup: each check must pass in the item mount (context: the item).
    const setup = node.map!.itemSetup;
    if (setup.length > 0) {
      const runState = this.deps.stores.runStore.loadRunState(runId);
      const scope = runState ? mapItemScope(new StateIndex(runState.run, runState.instances, runState.iterations ?? []), inst, index) : {};
      const codebases = this.itemCodebases(run, where.mounts);
      for (const [j, spec] of setup.entries()) {
        const outcome = await runCheck({
          stage: { check: spec } as Pick<CheckStage, 'check'>,
          run: { permissionMode: run.permissionMode, systemVars: { ...(run.systemVars ?? {}), codebases } },
          primaryDir: where.primaryDir,
          scope,
          scriptRunner: this.deps.scriptRunner,
          signal: new AbortController().signal,
        });
        const data = outcome.kind === 'succeeded' ? (outcome.output.data as { passed?: boolean; exitCode?: number; stderrTail?: string } | undefined) : undefined;
        if (outcome.kind !== 'succeeded' || data?.passed !== true) {
          const why =
            outcome.kind === 'failed'
              ? outcome.error.message
              : outcome.kind === 'aborted'
                ? 'aborted'
                : `${spec.command} exited with ${data?.exitCode ?? '?'}: ${(data?.stderrTail ?? '').slice(-400)}`;
          return { ok: false, code: 'item_setup_failed', error: `itemSetup ${j + 1} (${spec.command}) failed: ${why}`, ...where };
        }
      }
    }
    return { ok: true, ...where };
  }

  /** The run's codebases with each path moved to the item's mount of the same alias. */
  private itemCodebases(run: WorkflowRun, mounts: Record<string, string>): Record<string, RunCodebase> {
    const out: Record<string, RunCodebase> = {};
    for (const [alias, cb] of Object.entries(run.systemVars?.codebases ?? {})) {
      out[alias] = mounts[alias] ? { ...cb, path: mounts[alias]! } : cb;
    }
    return out;
  }

  // ── merges ────────────────────────────────────────────────────

  async mergeItem(runId: string, stageRunId: string, index: number, strategy: 'sequential' | 'pr_per_item'): Promise<MergeItemResult> {
    try {
      const ctx = await this.context(runId, stageRunId, index);
      if (!ctx.item?.workspaceId || !ctx.item.mounts) return { ok: false, code: 'merge_failed', error: 'The item has no mounts to merge' };
      return strategy === 'sequential' ? await this.mergeSequential(ctx) : await this.pushItem(ctx);
    } catch (err) {
      return { ok: false, code: 'merge_failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async mergeSequential(ctx: MapContext): Promise<MergeItemResult> {
    const { run, inst, state, item } = ctx;
    const svc = this.mounts!;
    const git = svc.git;
    const { workspaceRoot, mounts } = await this.runMounts(run);
    const release = await this.deps.leases.acquire(mounts.map((m) => worktreeLeaseKey(m.id)), 'exclusive', inst.id);
    try {
      const idx = (m: WorkspaceMount, what: string) => path.join(workspaceRoot, '.generatorai', 'map-index', `${inst.id}-${item!.index}-${refSafe(m.alias)}.${what}`);
      // 1. Every merged tree first: a conflict anywhere applies nothing.
      const plans: Array<{ mount: WorkspaceMount; from: string; to: string }> = [];
      const conflicts: string[] = [];
      for (const m of mounts) {
        const base = state.snapshot?.[m.alias];
        const itemPath = item!.mounts![m.alias];
        if (!base || !itemPath) continue;
        const itemTree = await git.writeTreeFromWorktree(itemPath, idx(m, 'item'), { honourEol: true });
        const baseTree = await git.revParse(m.path, `${base}^{tree}`);
        if (!itemTree) throw new Error(`the item mount "${m.alias}" could not be read`);
        if (itemTree === baseTree) continue; // the item changed nothing here
        const theirs = await git.commitTree(itemPath, itemTree, `GeneratorAI map item ${item!.index} (${item!.key})`, base);
        const curTree = await git.writeTreeFromWorktree(m.path, idx(m, 'run'), { honourEol: true });
        if (!curTree) throw new Error(`the run mount "${m.alias}" could not be read`);
        const head = await git.revParse(m.path, 'HEAD');
        const ours = await git.commitTree(m.path, curTree, 'GeneratorAI map merge base', head ?? undefined);
        const merged = await git.mergeTrees(m.path, base, ours, theirs);
        if (!merged.supported) throw new Error('git cannot merge trees here (git 2.40 or later is needed for merge-tree --merge-base)');
        if (merged.conflicts.length > 0 || !merged.tree) {
          conflicts.push(`${m.alias}: ${merged.conflicts.slice(0, 10).join(', ')}${merged.conflicts.length > 10 ? ` (+${merged.conflicts.length - 10})` : ''}`);
          continue;
        }
        if (merged.tree !== curTree) plans.push({ mount: m, from: curTree, to: merged.tree });
      }
      if (conflicts.length > 0) {
        return { ok: false, code: 'merge_conflict', error: `Item ${item!.index} (${item!.key}) conflicts with the run mount: ${conflicts.join('; ')}; its mount is kept at ${item!.primaryDir ?? '?'}` };
      }
      // 2. Apply (a fast-forward of each run mount's working tree); a failure rolls the applied ones back.
      const applied: typeof plans = [];
      try {
        for (const p of plans) {
          await git.checkoutTree(p.mount.path, p.from, p.to, idx(p.mount, 'apply'));
          applied.push(p);
        }
      } catch (err) {
        for (const p of applied.reverse()) await git.checkoutTree(p.mount.path, p.to, p.from, idx(p.mount, 'undo')).catch(() => undefined);
        throw err;
      }
      // Merged: the item mounts are released (worktrees and branches removed).
      await this.releaseItem(item!.workspaceId!);
      return { ok: true };
    } finally {
      release();
    }
  }

  private async pushItem(ctx: MapContext): Promise<MergeItemResult> {
    const { run, inst, item, lifecycle, graphName } = ctx;
    const steps = this.deps.platform().steps;
    if (!steps) return { ok: false, code: 'merge_failed', error: 'Post-processing steps cannot run in this process' };
    const pp = lifecycle.postProcessing;
    const push = pp.autoPush === true || pp.autoCreatePR === true;
    const plan: PostProcessingStep[] = [
      {
        name: `Commit item ${item!.index}`,
        config: { type: 'commit_and_push', commitMessage: `feat: ${inst.stageKey} item ${item!.key} (run {{run.id}})`, generateMessage: true, push },
        failOnError: true,
      },
      ...(pp.autoCreatePR
        ? [
            {
              name: `Pull request for item ${item!.index}`,
              config: {
                type: 'create_pr' as const,
                title: `GeneratorAI: ${inst.stageKey} — ${item!.key}`,
                body: `Item ${item!.index} (${item!.key}) of the map '${inst.stageKey}' in workflow run ${run.id}.`,
                generateText: true,
              },
              failOnError: true,
            },
          ]
        : []),
    ];
    const codebases = this.itemCodebases(run, item!.mounts!);
    const results = await steps.executePostProcessing(plan, {
      runId: run.id,
      runName: run.name,
      workflowName: graphName,
      workspaceId: item!.workspaceId!,
      workDir: item!.primaryDir ?? '',
      variables: { ...run.variables },
      codebases,
    });
    const url = results.flatMap((r) => r.scm ?? []).find((s) => s.pullRequest)?.pullRequest?.url ?? null;
    const pr = item!.branch ? { url, branch: item!.branch } : null;
    const failed = results.find((r) => !r.success);
    if (failed) return { ok: false, code: 'merge_failed', error: `${failed.stepName}: ${failed.error ?? 'failed'}`, pr };
    return { ok: true, pr };
  }

  /** Remove an item's worktrees (branches too) and its workspace. */
  private async releaseItem(workspaceId: string): Promise<void> {
    const svc = this.mounts;
    if (!svc) return;
    for (const m of await svc.list(workspaceId)) await svc.remove(m.id, { deleteBranch: true }).catch(() => undefined);
    await this.deps.workspaceManager.deleteWorkspace(workspaceId).catch((err: unknown) => this.deps.logger?.warn(`[MapEffects] item workspace ${workspaceId}: ${String(err)}`));
  }
}

/**
 * Where an instance inside a mount_per_item map item works: the nearest
 * enclosing map item that has its own mounts (null elsewhere). The executor
 * runs the instance in that item's workspace and primary mount, with the
 * run's codebases moved to the item's worktrees.
 */
export function mapItemPlacement(state: RunState, inst: InstanceState): MapItemState | null {
  const ix = new StateIndex(state.run, state.instances, state.iterations ?? []);
  for (const { container, iteration } of ix.chain(inst)) {
    const it = iteration !== null ? mapStateOf(container)?.items[iteration] : undefined;
    if (it?.workspaceId && it.primaryDir) return it;
  }
  return null;
}

/** A run as an instance inside a map item sees it: its primary directory and codebases are the item's. */
export function runForItem<R extends Pick<WorkflowRun, 'systemVars'>>(run: R, item: MapItemState): R {
  const codebases: Record<string, RunCodebase> = {};
  for (const [alias, cb] of Object.entries(run.systemVars?.codebases ?? {})) {
    codebases[alias] = item.mounts?.[alias] ? { ...cb, path: item.mounts[alias]!, branch: item.branch ?? cb.branch } : cb;
  }
  return { ...run, systemVars: { ...(run.systemVars ?? {}), workingDirectory: item.primaryDir ?? run.systemVars?.workingDirectory, codebases } };
}
