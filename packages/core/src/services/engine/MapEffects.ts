// ────────────────────────────────────────────────────────────────
// MapEffects — the effects of a `mount_per_item` map (P05 §4.1).
//
//   base          what the map forks from: the run mounts, or — a map
//                 nested in another map's item — that item's mounts
//   snapshot      take the map's SHARED lease on every base mount
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
//                 changed paths), and the item mounts are released. A map
//                 cancelled before the merge applies aborts it; one cancelled
//                 while it applied rolls it back.
//                 pr_per_item: the item branch is committed and — following
//                 lifecycle.postProcessing.autoPush / autoCreatePR — pushed
//                 and a PR opened, through the one source-control flow.
//   release       the map's shared lease (map settled, cancelled or
//                 failed; a merge in flight keeps its exclusive lease until
//                 it ends), then the item worktrees nobody reads any more:
//                 kept are the completed items of `merge: none` (later
//                 stages read their `workdir`), a conflicting item, a failed
//                 winner, every item while its winner is still to be picked,
//                 and the branches of `pr_per_item` (their commits); the rest
//                 go with their branches, and the snapshot refs with them.
//                 The run's finalize releases what was kept
//                 (`releaseRunMapItems`).
//
// Every effect answers with a message and never throws; a re-dispatch after
// a crash (RunSupervisor.recover) repeats idempotent steps.
// ────────────────────────────────────────────────────────────────

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { ILogger, RunCodebase, WorkflowRun, WorkspaceMount } from '@generatorai/shared';
import type { CheckStage, Lifecycle, PostProcessingStep, WorkflowGraph } from '@generatorai/workflow-spec';
import type { EngineStores } from '../../domain/ports/IEngineStore.js';
import type { IScriptRunner } from '../../domain/ports/IScriptRunner.js';
import type { WorkflowSecretResolver } from '../../mcp/McpCredentialVault.js';
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
  /** Resolves `secretref:workflow/<name>` values of check `env` and `custom_script` rule `env` (PLATFORM-R2); without it such a value fails the check. */
  workflowSecrets?: WorkflowSecretResolver | undefined;
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

/** Where a map forks from: a workspace and its mounts, in position order. */
interface MapBase {
  workspaceId: string;
  workspaceRoot: string;
  mounts: WorkspaceMount[];
}

/** The map's snapshot refs of a run (under one mount's repository). */
const snapshotRefPrefix = (runId: string, stageRunId?: string) => `refs/generatorai/maps/${refSafe(runId)}/${stageRunId ? `${refSafe(stageRunId)}/` : ''}`;

/** Delete every ref under `prefix` in a repository (best effort). */
async function deleteRefs(repoDir: string, prefix: string): Promise<void> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run('git', ['for-each-ref', '--format=%(refname)', prefix], { cwd: repoDir, timeout: 15_000 });
    for (const ref of stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
      await run('git', ['update-ref', '-d', ref], { cwd: repoDir, timeout: 15_000 }).catch(() => undefined);
    }
  } catch {
    /* a repository that is gone has no refs left */
  }
}

/**
 * Whether an item's worktrees stay after its map settled (see `release`):
 * `'all'` keeps them, `'branch'` removes the worktrees but keeps the
 * branches, `'none'` removes both.
 */
export function itemKept(map: MapState, merge: string, it: MapItemState): 'all' | 'branch' | 'none' {
  if (map.winner && map.winner.phase !== 'done') return 'all';
  if (it.phase === 'merging') return 'all'; // its merge is still in flight (a cancel): finalize releases it
  if (merge === 'pr_per_item') return 'branch';
  if (merge === 'none' && it.status === 'completed') return 'all';
  if (it.errorCode === 'merge_conflict') return 'all';
  if (map.winner?.outcome === 'failed' && map.winner.index === it.index) return 'all';
  return 'none';
}

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

  /**
   * Where an instance works, as a map base: the nearest enclosing
   * mount_per_item item's workspace, else the run's. A map forks from its
   * own placement (a nested map from its item's mounts).
   */
  private async baseOf(run: WorkflowRun, runState: RunState | null, inst: InstanceState | undefined): Promise<MapBase> {
    const svc = this.mounts;
    if (!svc) throw new Error('Mounts are not available in this process (no mount service)');
    const item = runState && inst ? mapItemPlacement(runState, inst) : null;
    const ws = item ? await this.deps.workspaceManager.getExecutionWorkspace(item.workspaceId!) : await runWorkspace(this.deps.workspaceManager, run);
    if (!ws) throw new Error(`The workspace ${item?.workspaceId ?? '?'} of the enclosing map item is gone`);
    const mounts = (await svc.list(ws.id)).filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position);
    return { workspaceId: ws.id, workspaceRoot: ws.rootPath, mounts };
  }

  /**
   * The mount lease keys of an instance's placement: a writer outside a
   * map takes `write` on them, a map its shared and exclusive leases.
   */
  async leaseKeys(runId: string, stageRunId: string): Promise<string[]> {
    try {
      const run = await this.deps.runRepo.getById(runId);
      const runState = this.deps.stores.runStore.loadRunState(runId);
      const inst = runState?.instances.find((i) => i.id === stageRunId);
      return (await this.baseOf(run, runState, inst)).mounts.map((m) => worktreeLeaseKey(m.id));
    } catch {
      return [];
    }
  }

  /** Whether the run is being cancelled, or the map itself was (a merge must not change the mount any more). */
  private cancelled(runId: string, stageRunId: string): boolean {
    const st = this.deps.stores.runStore.loadRunState(runId);
    if (!st) return true;
    if (st.run.status === 'cancelling' || st.run.status === 'cancelled') return true;
    return st.instances.find((i) => i.id === stageRunId)?.status === 'cancelled';
  }

  // ── snapshot ──────────────────────────────────────────────────

  async snapshot(runId: string, stageRunId: string): Promise<{ snapshot: Record<string, string> | null; error?: string }> {
    let release: (() => void) | undefined;
    try {
      const { run, inst } = await this.context(runId, stageRunId);
      const { workspaceRoot, mounts } = await this.baseOf(run, this.deps.stores.runStore.loadRunState(runId), inst);
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
        await git.updateRef(m.path, `${snapshotRefPrefix(runId, stageRunId)}${refSafe(m.alias)}`, sha);
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

  /**
   * The map settled (completed, failed, cancelled) or its winner did: its
   * shared lease goes at once (a queued snapshot is withdrawn; a merge in
   * flight keeps its exclusive lease until it ends), then the item
   * worktrees and snapshot refs nobody needs any more (`itemKept`).
   */
  async release(runId: string, stageRunId: string): Promise<void> {
    this.deps.leases.release(stageRunId, 'shared');
    let ctx: MapContext;
    try {
      ctx = await this.context(runId, stageRunId);
    } catch {
      return;
    }
    const { run, inst, state, node } = ctx;
    if (node.map!.workspace !== 'mount_per_item') return;
    for (const it of state.items) {
      if (!it.workspaceId) continue;
      const kept = itemKept(state, node.map!.merge, it);
      if (kept !== 'all') await this.releaseItem(it.workspaceId, { deleteBranch: kept === 'none' });
    }
    // The snapshot is the merge base: its refs go once no merge can come.
    if (state.winner && state.winner.phase !== 'done') return;
    if (state.items.some((it) => it.phase === 'merging')) return;
    try {
      const base = await this.baseOf(run, this.deps.stores.runStore.loadRunState(runId), inst);
      for (const m of base.mounts) await deleteRefs(m.path, snapshotRefPrefix(runId, stageRunId));
    } catch {
      /* the base is gone: so are its refs */
    }
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
    const base = await this.baseOf(run, this.deps.stores.runStore.loadRunState(runId), inst);
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
        // Per map instance: a map inside a loop or another map cuts new branches each time.
        const branch = (alias: string) =>
          `generatorai/${run.id.slice(0, 8)}-${inst.stageKey}-${inst.id.slice(0, 8)}-${index}${aliases.length > 1 ? `-${refSafe(alias)}` : ''}`;
        try {
          rows = await svc.forkFromSnapshot(base.workspaceId, state.snapshot, ws, { branchFor: branch });
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
      const codebases = this.itemCodebases(this.enclosingRun(run, inst), where.mounts);
      for (const [j, spec] of setup.entries()) {
        const outcome = await runCheck({
          stage: { check: spec } as Pick<CheckStage, 'check'>,
          run: { permissionMode: run.permissionMode, systemVars: { ...(run.systemVars ?? {}), codebases } },
          primaryDir: where.primaryDir,
          scope,
          scriptRunner: this.deps.scriptRunner,
          secrets: this.deps.workflowSecrets,
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

  /** The run as the map sees it: inside an enclosing item, its codebases are that item's. */
  private enclosingRun(run: WorkflowRun, inst: InstanceState): WorkflowRun {
    const runState = this.deps.stores.runStore.loadRunState(run.id);
    const outer = runState ? mapItemPlacement(runState, inst) : null;
    return outer ? runForItem(run, outer) : run;
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
    const { workspaceRoot, mounts } = await this.baseOf(run, this.deps.stores.runStore.loadRunState(run.id), inst);
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
      // A cancel that arrived while the merge waited or computed: nothing is applied.
      if (this.cancelled(run.id, inst.id)) return { ok: false, code: 'cancelled', error: 'The map was cancelled before its merge applied' };
      // 2. Apply (a fast-forward of each run mount's working tree); a failure rolls the applied ones back.
      const applied: typeof plans = [];
      const rollback = async () => {
        for (const p of applied.reverse()) await git.checkoutTree(p.mount.path, p.to, p.from, idx(p.mount, 'undo')).catch(() => undefined);
      };
      try {
        for (const p of plans) {
          await git.checkoutTree(p.mount.path, p.from, p.to, idx(p.mount, 'apply'));
          applied.push(p);
        }
      } catch (err) {
        await rollback();
        throw err;
      }
      // A cancel that arrived while it applied: the mount goes back to where it was.
      if (this.cancelled(run.id, inst.id)) {
        await rollback();
        return { ok: false, code: 'cancelled', error: 'The map was cancelled while its merge applied; the merge was rolled back' };
      }
      // Merged: the item mounts are released (worktrees and branches removed).
      await this.releaseItem(item!.workspaceId!, { deleteBranch: true });
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

  /** Remove an item's worktrees (and their branches, unless kept) and its workspace. */
  private async releaseItem(workspaceId: string, opts: { deleteBranch: boolean }): Promise<void> {
    await releaseItemWorkspace({ mounts: this.mounts, workspaceManager: this.deps.workspaceManager, logger: this.deps.logger }, workspaceId, opts);
  }
}

async function releaseItemWorkspace(
  deps: { mounts?: MountService | undefined; workspaceManager: WorkspaceManager; logger?: ILogger | undefined },
  workspaceId: string,
  opts: { deleteBranch: boolean },
): Promise<void> {
  const svc = deps.mounts;
  if (!svc) return;
  if (!(await deps.workspaceManager.getExecutionWorkspace(workspaceId).catch(() => null))) return; // released already
  for (const m of await svc.list(workspaceId)) await svc.remove(m.id, { deleteBranch: opts.deleteBranch }).catch(() => undefined);
  await deps.workspaceManager.deleteWorkspace(workspaceId).catch((err: unknown) => deps.logger?.warn(`[MapEffects] item workspace ${workspaceId}: ${String(err)}`));
}

/**
 * A run finalizes: every map item worktree still kept goes (a `pr_per_item`
 * item keeps its branch, which holds its commit), and every snapshot ref
 * of the run's maps with it.
 */
export async function releaseRunMapItems(
  deps: { stores: EngineStores; mounts?: MountService | undefined; workspaceManager: WorkspaceManager; logger?: ILogger | undefined },
  run: WorkflowRun,
  graph: WorkflowGraph,
): Promise<void> {
  const state = deps.stores.runStore.loadRunState(run.id);
  if (!state || !deps.mounts) return;
  const nodes = compile(graph).nodes;
  // Innermost first: a nested map's items are worktrees of its enclosing item's.
  const maps = state.instances.filter((i) => mapStateOf(i) !== null).sort((a, b) => b.instancePath.length - a.instancePath.length);
  for (const inst of maps) {
    const ms = mapStateOf(inst)!;
    const merge = nodes.get(inst.stageKey)?.map?.merge;
    for (const it of ms.items) {
      if (!it.workspaceId) continue;
      await releaseItemWorkspace(deps, it.workspaceId, { deleteBranch: merge !== 'pr_per_item' });
    }
  }
  // Worktrees share their repository's refs: the run mounts hold every map's snapshot refs.
  const ws = await runWorkspace(deps.workspaceManager, run).catch(() => null);
  if (ws) for (const m of await deps.mounts.list(ws.id)) if (m.git?.isRepo && m.status !== 'removed') await deleteRefs(m.path, snapshotRefPrefix(run.id));
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
