// ────────────────────────────────────────────────────────────────
// The generic map (P05 §4.1), inside the pure decide(). The engine knows
// only the `map` kind: every fan-out scenario is a template graph.
//
//   map ready        items := eval(map.items) in the map's place (context T
//                    of its enclosing loops, the items of enclosing maps);
//                    not a list / over maxItems / a duplicate key fails the
//                    map; keys := itemKey per item (default the index)
//   mount_per_item   effect map_snapshot: a snapshot commit of every run
//                    mount (the map holds a shared lease on each mount's
//                    `worktree:<mountId>`, so writers outside the map wait)
//   item start       up to `concurrency` items at a time, in index order:
//                    shared → scope <map>#<i> at once; mount_per_item →
//                    effect map_prepare_item (the item's worktrees cut from
//                    the snapshot, all or nothing, then itemSetup) → scope
//   scope i terminal outcome(i) = the scope outcome; completed with a
//                    merge → queued; merges run one at a time (effect
//                    map_merge_item: a 3-way merge fast-forwarded into the
//                    run mount under the exclusive lease, or a branch + PR);
//                    a conflict fails the item (merge_conflict)
//   all items done   results[i] = {index, key, item, status, error, stages,
//                    pr, branch, workdir, ...select (per item scope)}; failures = the failed
//                    ones; failed% ≤ toleratedFailurePercent → completed,
//                    else failed (map_tolerance_exceeded); effect
//                    map_release (the shared lease, and the item worktrees
//                    no later stage reads)
//   winner merge     (P08 §7, merge {mode: winner, key}) no item merges
//                    while the map runs; once it completed and the stages
//                    its key reads (the judge, after the map) settled, the
//                    key is evaluated and the item it names is merged
//                    (map_merge_item, sequential; once settled, map_release
//                    frees the candidates). Stages after the judge
//                    wait for that merge, and their scope does not end
//                    before it; a key naming no completed item, or a failed
//                    merge, fails them and the run (map_winner_failed)
//
// Item scopes are keyed by the item index (`item_index`); the key is kept
// in `item_key` and the map state. A cancelled map takes its items with it
// (the working copy's cancel cascade) and releases its leases.
// ────────────────────────────────────────────────────────────────

import { evaluate, isTerminalStageRunState } from '@generatorai/workflow-spec';
import { classified } from '../errors/StageError.js';
import type { CompiledExpr, CompiledNode } from '../workflow-graph/compile.js';
import { instanceId } from './ids.js';
import { instanceScope, mapItemScope, mapStateOf, scopeIndexOf } from './scope.js';
import { computeScopeOutcome } from './terminal.js';
import type { InstanceState, MapItemState, MapState, Usage } from './types.js';
import { failInstance, stageEvent, type Working } from './working.js';

type MapInstance = InstanceState & { containerState: MapState };

function isMap(i: InstanceState): i is MapInstance {
  return mapStateOf(i) !== null;
}

function mapEvent(w: Working, kind: string, inst: InstanceState, data: Record<string, unknown> = {}): void {
  w.emit(kind, { stageRunId: inst.id, stageKey: inst.stageKey, instancePath: inst.instancePath, version: inst.version, ...data });
}

type ExprValue = { ok: true; value: unknown } | { ok: false; message: string };

function evalExpr(expr: CompiledExpr, scope: Record<string, unknown>): ExprValue {
  if ('error' in expr) return { ok: false, message: `cannot parse "${expr.source}": ${expr.error}` };
  const r = evaluate(expr.ast, scope);
  return r.ok ? { ok: true, value: r.value } : { ok: false, message: `"${expr.source}": ${r.error.message}` };
}

function setMap(w: Working, inst: MapInstance, patch: Partial<MapState>): MapState {
  const next: MapState = { ...inst.containerState, ...patch };
  w.instancePatch(inst, { containerState: next });
  return next;
}

function setItem(w: Working, inst: MapInstance, index: number, patch: Partial<MapItemState>): void {
  const items = inst.containerState.items.map((it) => (it.index === index ? { ...it, ...patch } : it));
  setMap(w, inst, { items });
}

const tokensOf = (u: Usage) => (u.inputTokens ?? 0) + (u.outputTokens ?? 0);

/** The map's cumulative budget is spent: no further item starts. */
function budgetSpent(inst: InstanceState, node: CompiledNode): boolean {
  const b = node.budget;
  if (!b) return false;
  const u = inst.usage;
  return (
    (b.maxTurns !== undefined && (u.turns ?? 0) >= b.maxTurns) ||
    (b.maxCostUsd !== undefined && (u.costUsd ?? 0) >= b.maxCostUsd) ||
    (b.maxTokens !== undefined && tokensOf(u) >= b.maxTokens)
  );
}

// ── Start ─────────────────────────────────────────────────────────

/** A map that cannot start: `ready → running → failed` (a container never fails from ready). */
function failStart(w: Working, inst: InstanceState, code: 'map_items_invalid' | 'map_too_large' | 'map_duplicate_item_key', message: string): void {
  w.transition(inst, 'running', { statusReason: null, containerState: { kind: 'map', phase: 'done', count: 0, snapshot: null, items: [] } });
  failInstance(w, inst, classified(code, message), `map:${code}`);
}

/** A ready map: its items and keys, then (mount_per_item) the snapshot, else the first items. */
export function startMap(w: Working, inst: InstanceState, node: CompiledNode): void {
  const map = node.map!;
  const scope = instanceScope(w.ix(), inst);
  const items = evalExpr(map.items, scope);
  if (!items.ok) return failStart(w, inst, 'map_items_invalid', `The map's items could not be evaluated: ${items.message}`);
  const list = items.value === null ? [] : items.value;
  if (!Array.isArray(list)) return failStart(w, inst, 'map_items_invalid', `The map's items are not a list (${typeof list})`);
  if (list.length > map.maxItems) {
    return failStart(w, inst, 'map_too_large', `The map has ${list.length} items; at most ${map.maxItems} are allowed (maxItems)`);
  }
  const keys: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let key = String(i);
    if (map.itemKey) {
      const r = evalExpr(map.itemKey, { ...scope, item: list[i], map: { index: i, key: String(i), count: list.length } });
      if (!r.ok) return failStart(w, inst, 'map_items_invalid', `The key of item ${i} could not be evaluated: ${r.message}`);
      if (typeof r.value !== 'string' && typeof r.value !== 'number') {
        return failStart(w, inst, 'map_items_invalid', `The key of item ${i} is not a string (${r.value === null ? 'null' : typeof r.value})`);
      }
      key = String(r.value);
    }
    keys.push(key);
  }
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup !== undefined) return failStart(w, inst, 'map_duplicate_item_key', `Two items have the key '${dup}' (itemKey must be unique)`);

  const state: MapState = {
    kind: 'map',
    phase: map.workspace === 'mount_per_item' && list.length > 0 ? 'snapshotting' : 'running',
    count: list.length,
    snapshot: null,
    items: list.map((item, index) => ({
      index,
      key: keys[index]!,
      item,
      phase: 'pending',
      status: null,
      errorCode: null,
      error: null,
      workspaceId: null,
      mounts: null,
      primaryDir: null,
      branch: null,
      pr: null,
    })),
  };
  w.transition(inst, 'running', { statusReason: null, containerState: state });
  stageEvent(w, 'stage_run.running', inst, { kind: 'map' });
  mapEvent(w, 'map.started', inst, { count: list.length, workspace: map.workspace });
  if (state.phase === 'snapshotting') w.push({ t: 'map_snapshot', stageRunId: inst.id });
}

export function onMapSnapshotTaken(w: Working, msg: { stageRunId: string; snapshot: Record<string, string> | null; error?: string }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isMap(inst) || inst.status !== 'running' || inst.containerState.phase !== 'snapshotting') {
    // A map cancelled while its snapshot ran: the shared lease it may have taken after the cancel goes.
    if (inst && msg.snapshot) w.push({ t: 'map_release', stageRunId: msg.stageRunId });
    return;
  }
  if (!msg.snapshot) {
    const err = classified('mount_fork_failed', `The run mounts could not be snapshotted for mount_per_item: ${msg.error ?? 'unknown error'}`);
    setMap(w, inst, { phase: 'done' });
    w.push({ t: 'map_release', stageRunId: inst.id });
    return failInstance(w, inst, err, 'map:mount_fork_failed');
  }
  setMap(w, inst, { phase: 'running', snapshot: msg.snapshot });
}

// ── Items ─────────────────────────────────────────────────────────

function createItemScope(w: Working, inst: MapInstance, node: CompiledNode, it: MapItemState): void {
  w.addInstances(
    node.body.map((key) => {
      const body = w.graph.nodes.get(key)!;
      const path = `${inst.instancePath}#${it.index}/${key}`;
      return {
        id: instanceId(w.run.id, path),
        stageKey: key,
        kind: body.kind,
        name: body.name,
        instancePath: path,
        scopeId: inst.id,
        itemIndex: it.index,
        itemKey: it.key,
      };
    }),
  );
  mapEvent(w, 'map.item_started', inst, { index: it.index, key: it.key });
}

function finishItem(w: Working, inst: MapInstance, it: MapItemState, status: 'completed' | 'failed' | 'cancelled', code: string | null, error: string | null, extra: Partial<MapItemState> = {}): void {
  setItem(w, inst, it.index, { phase: 'done', status, errorCode: code, error, ...extra });
  mapEvent(w, 'map.item_completed', inst, { index: it.index, key: it.key, status, ...(code ? { code } : {}), ...(error ? { error } : {}) });
}

/** Start items up to the concurrency, in index order. */
function startItems(w: Working, inst: MapInstance, node: CompiledNode): boolean {
  const map = node.map!;
  let changed = false;
  const busy = () => inst.containerState.items.filter((i) => i.phase === 'preparing' || i.phase === 'running').length;
  for (const it of inst.containerState.items) {
    if (it.phase !== 'pending') continue;
    if (busy() >= map.concurrency) break;
    changed = true;
    if (budgetSpent(inst, node)) {
      finishItem(w, inst, it, 'failed', 'budget_exceeded', "The map's budget was spent before this item started");
      continue;
    }
    if (map.workspace === 'mount_per_item') {
      setItem(w, inst, it.index, { phase: 'preparing' });
      w.push({ t: 'map_prepare_item', stageRunId: inst.id, index: it.index });
    } else {
      setItem(w, inst, it.index, { phase: 'running' });
      createItemScope(w, inst, node, it);
    }
  }
  return changed;
}

export function onMapItemPrepared(
  w: Working,
  msg: { stageRunId: string; index: number; ok: boolean; workspaceId?: string; mounts?: Record<string, string>; primaryDir?: string; branch?: string | null; code?: string; error?: string },
): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isMap(inst) || inst.status !== 'running') return;
  const it = inst.containerState.items[msg.index];
  if (!it || it.phase !== 'preparing') return; // stale or duplicate
  const node = w.node(inst);
  if (!node?.map) return;
  const where = {
    ...(msg.workspaceId ? { workspaceId: msg.workspaceId } : {}),
    ...(msg.mounts ? { mounts: msg.mounts } : {}),
    ...(msg.primaryDir ? { primaryDir: msg.primaryDir } : {}),
    ...(msg.branch !== undefined ? { branch: msg.branch } : {}),
  };
  if (!msg.ok) return finishItem(w, inst, it, 'failed', msg.code ?? 'mount_fork_failed', msg.error ?? 'The item mount could not be prepared', where);
  setItem(w, inst, it.index, { phase: 'running', ...where });
  createItemScope(w, inst, node, { ...it, ...where });
}

export function onMapItemMerged(w: Working, msg: { stageRunId: string; index: number; ok: boolean; code?: string; error?: string; pr?: { url: string | null; branch: string } | null }): void {
  const inst = w.get(msg.stageRunId);
  if (!inst || !isMap(inst)) return;
  const win = inst.containerState.winner;
  if (inst.status === 'completed' && win?.phase === 'merging' && win.index === msg.index) {
    const error = msg.ok ? null : `The winner '${win.key}' could not be merged (${msg.code ?? 'merge_failed'}): ${msg.error ?? 'the merge failed'}`;
    setMap(w, inst, { winner: { ...win, phase: 'done', outcome: msg.ok ? 'merged' : 'failed', error } });
    mapEvent(w, 'map.winner_settled', inst, { index: win.index, key: win.key, outcome: msg.ok ? 'merged' : 'failed', ...(error ? { error } : {}) });
    // The candidates are not read any more: the losers' worktrees go (P05 §4.1 release).
    w.push({ t: 'map_release', stageRunId: inst.id });
    return;
  }
  if (inst.status !== 'running') return;
  const it = inst.containerState.items[msg.index];
  if (!it || it.phase !== 'merging') return;
  if (msg.ok) return finishItem(w, inst, it, 'completed', null, null, { pr: msg.pr ?? null });
  finishItem(w, inst, it, 'failed', msg.code ?? 'merge_failed', msg.error ?? 'The merge failed', { pr: msg.pr ?? null });
}

/** Items whose scope finished: done, or queued for their merge. */
function settleItems(w: Working, inst: MapInstance, node: CompiledNode): boolean {
  const map = node.map!;
  let changed = false;
  for (const it of inst.containerState.items) {
    if (it.phase !== 'running') continue;
    const scope = w.scopeInstances(inst.id, it.index);
    if (scope.length === 0 || !scope.every((i) => isTerminalStageRunState(i.status)) || winnerPending(scope)) continue;
    changed = true;
    const outcome = computeScopeOutcome(w.graph, scope, w.scopeFor);
    // A winner merge brings no item back while the map runs (its judge runs after the map).
    if (outcome === 'completed' && (map.merge === 'sequential' || map.merge === 'pr_per_item') && map.workspace === 'mount_per_item') {
      setItem(w, inst, it.index, { phase: 'merge_queued' });
      continue;
    }
    const broken = scope.find((i) => i.status === 'failed') ?? scope.find((i) => i.status === 'cancelled');
    finishItem(
      w,
      inst,
      it,
      outcome,
      outcome === 'completed' ? null : (broken?.errorCode ?? null),
      outcome === 'completed' ? null : `${broken ? `'${broken.stageKey}' ${broken.status}` : outcome}${broken?.error ? `: ${broken.error}` : ''}`,
    );
  }
  // One merge at a time (sequential merges fast-forward the same mount; PR pushes are serialised too).
  if (!inst.containerState.items.some((i) => i.phase === 'merging')) {
    const next = inst.containerState.items.find((i) => i.phase === 'merge_queued');
    if (next) {
      changed = true;
      setItem(w, inst, next.index, { phase: 'merging' });
      w.push({ t: 'map_merge_item', stageRunId: inst.id, index: next.index, strategy: map.merge === 'pr_per_item' ? 'pr_per_item' : 'sequential' });
    }
  }
  return changed;
}

// ── The map's end ─────────────────────────────────────────────────

/** The map output (P05 §4.1): one entry per item, the per-item `select`, and the failed entries. */
function mapOutput(w: Working, inst: MapInstance, node: CompiledNode): Record<string, unknown> {
  const map = node.map!;
  const ix = w.ix();
  const results = inst.containerState.items.map((it) => {
    const stages: Record<string, unknown> = {};
    for (const i of ix.scope(inst.id, it.index)) stages[i.stageKey] = { status: i.status, output: i.output ?? null, summary: i.summary };
    const entry: Record<string, unknown> = {
      index: it.index,
      key: it.key,
      item: it.item,
      status: it.status ?? 'skipped',
      error: it.error,
      stages,
      pr: it.pr,
      // mount_per_item: the item's branch and primary worktree (a judge reads the candidates there).
      branch: it.branch,
      workdir: it.primaryDir,
    };
    if (map.select.length > 0) {
      const scope = mapItemScope(ix, inst, it.index);
      for (const [name, expr] of map.select) {
        if (name in entry) continue;
        const r = evalExpr(expr, scope);
        entry[name] = r.ok ? r.value : null;
      }
    }
    return entry;
  });
  return { count: inst.containerState.count, results, failures: results.filter((r) => r['status'] !== 'completed') };
}

function completeMap(w: Working, inst: MapInstance, node: CompiledNode): void {
  const map = node.map!;
  const output = mapOutput(w, inst, node);
  const failures = (output['failures'] as unknown[]).length;
  const count = inst.containerState.count;
  const failedPct = count === 0 ? 0 : (failures / count) * 100;
  const failing = failedPct > map.toleratedFailurePercent;
  // A winner merge waits for its judge; the item mounts stay until then.
  const winner = map.winner && map.workspace === 'mount_per_item' && !failing ? { winner: { phase: 'waiting' as const, index: null, key: null, outcome: null, error: null } } : {};
  setMap(w, inst, { phase: 'done', ...winner });
  if (map.workspace === 'mount_per_item') w.push({ t: 'map_release', stageRunId: inst.id });
  if (failing) {
    w.instancePatch(inst, { outputData: output });
    const first = inst.containerState.items.find((i) => i.status !== 'completed');
    const err = classified(
      'map_tolerance_exceeded',
      `${failures} of ${count} items failed (${Math.round(failedPct)}%, tolerated ${map.toleratedFailurePercent}%)${first ? `; item ${first.index} (${first.key}): ${first.error ?? first.status}` : ''}`,
    );
    return failInstance(w, inst, err, 'map:tolerance_exceeded');
  }
  w.transition(inst, 'completed', {
    statusReason: null,
    outputData: output,
    summary: `Map '${node.name}': ${count - failures} of ${count} items completed`,
    error: null,
    errorClass: null,
    errorCode: null,
  });
  w.push({ t: 'cancel_timer', stageRunId: inst.id });
  stageEvent(w, 'stage_run.completed', inst, { count, failures });
}

// ── The winner merge (P08 §7) ─────────────────────────────────────

/** A completed map's winner: once the stages its key reads settled, merge the item it names (or settle without one). */
function settleWinner(w: Working, inst: MapInstance, node: CompiledNode): boolean {
  const win = inst.containerState.winner;
  const spec = node.map!.winner;
  if (!win || win.phase !== 'waiting' || !spec) return false;
  const reads = spec.after.map((k) => w.sibling(inst, k)).filter((i): i is InstanceState => i !== undefined);
  if (reads.some((i) => !isTerminalStageRunState(i.status))) return false;
  const settle = (outcome: 'none' | 'failed', error: string | null) => {
    setMap(w, inst, { winner: { ...win, phase: 'done', outcome, error } });
    mapEvent(w, 'map.winner_settled', inst, { outcome, ...(error ? { error } : {}) });
    w.push({ t: 'map_release', stageRunId: inst.id });
    return true;
  };
  const unfinished = reads.find((i) => i.status !== 'completed');
  if (unfinished) return settle('none', `'${unfinished.stageKey}' ${unfinished.status}: no winner was picked`);
  const r = evalExpr(spec.key, instanceScope(w.ix(), inst));
  if (!r.ok) return settle('failed', `The winner key could not be evaluated: ${r.message}`);
  if (r.value === null) return settle('none', null);
  if (typeof r.value !== 'string' && typeof r.value !== 'number') return settle('failed', `The winner key is not a string (${typeof r.value})`);
  const key = String(r.value);
  const it = inst.containerState.items.find((i) => i.key === key);
  if (!it) return settle('failed', `No item of '${inst.stageKey}' has the key '${key}' (the items: ${inst.containerState.items.map((i) => i.key).join(', ')})`);
  if (it.status !== 'completed') return settle('failed', `The winner '${key}' did not complete (${it.status ?? it.phase})`);
  setMap(w, inst, { winner: { ...win, phase: 'merging', index: it.index, key } });
  mapEvent(w, 'map.winner_selected', inst, { index: it.index, key });
  w.push({ t: 'map_merge_item', stageRunId: inst.id, index: it.index, strategy: 'sequential' });
  return true;
}

/** A scope with a winner merge still to settle has not ended (its judge's successors see the merged winner). */
export function winnerPending(scope: readonly InstanceState[]): boolean {
  return scope.some((i) => {
    const phase = mapStateOf(i)?.winner?.phase;
    return phase === 'waiting' || phase === 'merging';
  });
}

/** A failed winner merge of the run (it fails the run: its outcome would silently lack the winner). */
export function failedWinner(w: Working): { inst: InstanceState; error: string } | null {
  for (const i of w.sorted()) {
    const win = mapStateOf(i)?.winner;
    if (win?.outcome === 'failed') return { inst: i, error: win.error ?? `The winner merge of '${i.stageKey}' failed` };
  }
  return null;
}

/**
 * Whether a pending instance waits for a winner merge: an edge into it
 * comes from a stage a sibling map's winner key reads (the judge). `fail`
 * once that merge failed.
 */
export function winnerGate(w: Working, inst: InstanceState, node: CompiledNode): { kind: 'wait' } | { kind: 'fail'; message: string } | null {
  if (node.incoming.length === 0) return null;
  const from = new Set(node.incoming.map((e) => e.from));
  for (const s of w.ix().scope(inst.scopeId, scopeIndexOf(inst))) {
    const win = mapStateOf(s)?.winner;
    if (!win) continue;
    const reads = w.node(s)?.map?.winner?.after ?? [];
    if (!reads.some((k) => from.has(k))) continue;
    if (win.phase !== 'done') return { kind: 'wait' };
    if (win.outcome === 'failed') return { kind: 'fail', message: win.error ?? `The winner merge of '${s.stageKey}' failed` };
  }
  return null;
}

// ── Settle ────────────────────────────────────────────────────────

/** Maps that can move without a message: ready ones start, finished items settle, free slots start items, the last item completes the map. */
export function settleMaps(w: Working): boolean {
  let changed = false;
  for (const inst of w.sorted()) {
    const node = w.node(inst);
    if (!node?.map) continue;
    if (isMap(inst) && inst.status === 'completed') {
      if (settleWinner(w, inst, node)) changed = true;
      continue;
    }
    if (inst.status === 'ready' && inst.containerState == null) {
      startMap(w, inst, node);
      changed = true;
      continue;
    }
    if (!isMap(inst) || inst.status !== 'running' || inst.containerState.phase !== 'running') continue;
    if (settleItems(w, inst, node)) changed = true;
    if (w.run.status === 'running' || w.run.status === 'waiting') {
      if (startItems(w, inst, node)) changed = true;
    }
    if (inst.containerState.items.every((i) => i.phase === 'done')) {
      completeMap(w, inst, node);
      changed = true;
    }
  }
  return changed;
}

/** The item scopes readiness runs in: every running item of every running map. */
export function mapScopes(w: Working): Array<{ containerId: string; iteration: number }> {
  const out: Array<{ containerId: string; iteration: number }> = [];
  for (const i of w.sorted()) {
    if (!isMap(i) || i.status !== 'running') continue;
    for (const it of i.containerState.items) if (it.phase === 'running') out.push({ containerId: i.id, iteration: it.index });
  }
  return out;
}

/** A map with an effect in flight (the snapshot, an item's preparation, a merge) keeps the run busy. */
export function mapBusy(i: InstanceState): boolean {
  const ms = mapStateOf(i);
  if (ms?.winner?.phase === 'merging') return true;
  if (!ms || i.status !== 'running') return false;
  return ms.phase === 'snapshotting' || ms.items.some((it) => it.phase === 'preparing' || it.phase === 'merging');
}
