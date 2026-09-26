// ────────────────────────────────────────────────────────────────
// Stream scope fan-out (open questions #4, #17, #22).
//
// This logic decides who sees which event. It lived as an unexported closure
// inside `composition-root.ts`'s 1000-line setup function and had NO test —
// so both scopes added to it (automation, then workspace) shipped on a
// read-it-and-hope basis, and the third (global) would have too.
//
// Two failure directions matter, and they are opposites:
//
//   - too few  → a pane silently never updates. That is how the workspace
//                scope came to be needed at all: `checkpoint.created` was
//                emitted correctly and fanned out to nobody.
//   - too many → `harness.token` reaching a scope every client subscribes to
//                multiplies the busiest traffic in the system by the client
//                count, to say something no view renders.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  deriveStreamScopes,
  GLOBAL_SCOPE_ID,
  LIFECYCLE_EVENT_KINDS,
} from '../composition/streamScopes.js';

const at = (sessionId: string, kind: string, data: unknown) =>
  deriveStreamScopes({ sessionId, kind, data });

describe('per-entity scopes', () => {
  it('fans a run-keyed event out to its run', () => {
    expect(at('s1', 'stage_run.running', { workflowRunId: 'r1' })).toContainEqual({
      scope: 'run',
      id: 'r1',
    });
  });

  it('does not republish an engine outbox event to its run (the outbox already published it, awaited)', () => {
    const targets = at('__global__', 'stage_run.completed', { workflowRunId: 'r1', stageRunId: 's', runSeq: 7 });
    expect(targets.some((t) => t.scope === 'run')).toBe(false);
  });

  it('fans a chat-keyed event out to its chat', () => {
    expect(at('s1', 'harness.token', { chatId: 'c1', text: 'x' })).toEqual([
      { scope: 'chat', id: 'c1' },
    ]);
  });

  it('fans an event carrying both ids out to both', () => {
    const targets = at('s1', 'workspace.changed', { workflowRunId: 'r1', chatId: 'c1', workspaceId: 'w1' });
    expect(targets).toEqual([
      { scope: 'run', id: 'r1' },
      { scope: 'chat', id: 'c1' },
      { scope: 'workspace', id: 'w1' },
    ]);
  });

  it('fans a workspace-keyed event out to its workspace', () => {
    // The gap this scope was added for: emitted correctly, reaching nobody.
    expect(at('s1', 'checkpoint.created', { workspaceId: 'w1', checkpointId: 'cp1' })).toEqual([
      { scope: 'workspace', id: 'w1' },
    ]);
  });

  it('ignores an empty or non-string id rather than publishing to a blank scope', () => {
    expect(at('s1', 'stage_run.running', { workflowRunId: '' })).toEqual([]);
    expect(at('s1', 'stage_run.running', { workflowRunId: 42 })).toEqual([]);
    expect(at('s1', 'stage_run.running', null)).toEqual([]);
    expect(at('s1', 'stage_run.running', undefined)).toEqual([]);
  });
});

describe('automation scopes', () => {
  it('fans an execution event out to BOTH its execution and its automation', () => {
    // Per-execution is what a pane following one run attaches to;
    // per-automation is what a pane showing the whole execution HISTORY
    // needs. With only the first, such a pane could follow one execution —
    // whichever happened to be running when it was opened — and went
    // permanently stale the moment that one finished.
    expect(at('s1', 'automation_execution.progress', { executionId: 'e1', automationId: 'a1' })).toEqual([
      { scope: 'automation', id: 'e1' },
      { scope: 'automation', id: 'a1' },
    ]);
  });

  it('only reads those ids for automation_execution.* events', () => {
    // `executionId` is not a reserved word; another event carrying one must
    // not be republished as automation progress.
    expect(at('s1', 'script.stdout', { executionId: 'e1', automationId: 'a1' })).toEqual([]);
  });

  it('handles an iteration event that carries no automationId', () => {
    expect(at('s1', 'automation_execution.iteration_started', { executionId: 'e1' })).toEqual([
      { scope: 'automation', id: 'e1' },
    ]);
  });
});

describe('the global lifecycle scope', () => {
  it('fans an entity lifecycle event out to global, so a list view can stay correct', () => {
    expect(at('s1', 'chat.created', { chatId: 'c1', name: 'x' })).toContainEqual({
      scope: 'global',
      id: GLOBAL_SCOPE_ID,
    });
  });

  it('does NOT fan out high-frequency events, whatever they carry', () => {
    // The whole reason the list is closed rather than a prefix match: one
    // `harness.token` per streamed character, times every connected client.
    for (const kind of [
      'harness.token',
      'harness.reasoning_delta',
      'stage_run.step_started',
      'workspace.changed',
      'chat.prompt_sent',
    ]) {
      const targets = at('s1', kind, { chatId: 'c1', workflowRunId: 'r1', workspaceId: 'w1' });
      expect(targets.some((t) => t.scope === 'global'), `${kind} reached global`).toBe(false);
    }
  });

  it('does not double-publish an event that already arrived by the global path', () => {
    // `subscribeGlobal` passes `__global__`, and the event store has already
    // appended it on the global scope — republishing would deliver it twice
    // to every subscriber.
    expect(at('__global__', 'chat.created', { chatId: 'c1' })).not.toContainEqual({
      scope: 'global',
      id: GLOBAL_SCOPE_ID,
    });
    // …while its per-entity fan-out is unaffected.
    expect(at('__global__', 'chat.created', { chatId: 'c1' })).toEqual([{ scope: 'chat', id: 'c1' }]);
  });

  it('covers create, terminal-state and delete for every entity a list pane shows', () => {
    // A list that learns about creation but not deletion shows rows for
    // things that no longer exist, which is worse than being merely stale.
    for (const kind of ['chat.created', 'chat.deleted', 'chat.archived']) {
      expect(LIFECYCLE_EVENT_KINDS.has(kind), kind).toBe(true);
    }
    for (const kind of [
      'workflow_run.created',
      'workflow_run.completed',
      'workflow_run.failed',
      'workflow_run.cancelled',
    ]) {
      expect(LIFECYCLE_EVENT_KINDS.has(kind), kind).toBe(true);
    }
    for (const kind of ['automation_execution.started', 'automation_execution.completed']) {
      expect(LIFECYCLE_EVENT_KINDS.has(kind), kind).toBe(true);
    }
  });

  it('names only kinds that really exist in the event union', async () => {
    // A lifecycle kind with a typo is a list that never updates, and nothing
    // else would ever report it.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL('../../../../packages/shared/src/types/AgentEvent.ts', import.meta.url),
        'utf8',
      ),
    );
    for (const kind of LIFECYCLE_EVENT_KINDS) {
      expect(source.includes(`kind: '${kind}'`), `${kind} is not a declared event kind`).toBe(true);
    }
  });
});
