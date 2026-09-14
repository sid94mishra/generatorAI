// ────────────────────────────────────────────────────────────────
// `chat.scm.result` → the transcript's `scm_result` block.
//
// In agent-native mode the PLATFORM commits, not the agent, so nothing the
// agent streams says a commit happened. This event is the only record, and
// it is upserted by `turnId` rather than appended: a turn runs the flow
// once, but the user may resolve a merge conflict and re-run it, and the
// second outcome corrects the first instead of stacking under it.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { StreamEventRouter, applyStreamEffects } from '../index.js';
import type { StreamsRecord, ScmResultBlock } from '../stream/types.js';
import type { ScmFlowResult, RepoReadiness } from '@generatorai/shared';

const KEY = 'sess-1';

function route(router: StreamEventRouter, kind: string, data: Record<string, unknown>) {
  return router.handle(KEY, { kind, data } as never);
}

function resultsOf(streams: StreamsRecord): ScmResultBlock[] {
  return (streams[KEY]?.blocks ?? []).filter(
    (b): b is ScmResultBlock => b.type === 'scm_result',
  );
}

const readiness = { alias: '.', repoDir: '/w/repo' } as unknown as RepoReadiness;

function okResult(sha: string): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [{ id: 'commit', status: 'done' }],
    commit: { sha, message: 'Update three files' },
    pushed: true,
    readiness,
  };
}

function conflictResult(): ScmFlowResult {
  return {
    status: 'conflicts',
    alias: '.',
    steps: [
      { id: 'commit', status: 'done' },
      { id: 'sync', status: 'blocked', detail: 'merge conflicts' },
    ],
    conflicts: { base: 'main', head: 'generatorai/x', files: ['src/a.ts'], mergeStarted: false },
    readiness,
  };
}

describe('chat.scm.result → scm_result blocks', () => {
  it('creates one block carrying the whole flow result', () => {
    const router = new StreamEventRouter();
    const streams = applyStreamEffects(
      {},
      route(router, 'chat.scm.result', { chatId: 'c1', turnId: 't1', result: okResult('abc1234') }),
    );

    const blocks = resultsOf(streams);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.turnId).toBe('t1');
    expect(blocks[0]!.result.status).toBe('ok');
    expect(blocks[0]!.result.commit?.sha).toBe('abc1234');
    expect(blocks[0]!.result.pushed).toBe(true);
  });

  it('replaces the result for the same turn instead of appending a second card', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = applyStreamEffects(
      {},
      route(router, 'chat.scm.result', { chatId: 'c1', turnId: 't1', result: conflictResult() }),
    );
    expect(resultsOf(streams)[0]!.result.status).toBe('conflicts');

    // The user resolved the conflict and the flow ran again for the SAME turn.
    streams = applyStreamEffects(
      streams,
      route(router, 'chat.scm.result', { chatId: 'c1', turnId: 't1', result: okResult('def5678') }),
    );

    const blocks = resultsOf(streams);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.result.status).toBe('ok');
    expect(blocks[0]!.result.commit?.sha).toBe('def5678');
  });

  it('keeps one block per turn', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = applyStreamEffects(
      {},
      route(router, 'chat.scm.result', { turnId: 't1', result: okResult('aaa1111') }),
    );
    streams = applyStreamEffects(
      streams,
      route(router, 'chat.scm.result', { turnId: 't2', result: okResult('bbb2222') }),
    );

    expect(resultsOf(streams).map((b) => b.turnId)).toEqual(['t1', 't2']);
  });

  it('is a genuine no-op when the identical result is replayed', () => {
    const router = new StreamEventRouter();
    const result = okResult('abc1234');
    const first = applyStreamEffects({}, route(router, 'chat.scm.result', { turnId: 't1', result }));
    const second = applyStreamEffects(first, route(router, 'chat.scm.result', { turnId: 't1', result }));
    expect(second).toBe(first);
  });

  it('ignores an event with no turnId or no result', () => {
    const router = new StreamEventRouter();
    let streams: StreamsRecord = applyStreamEffects(
      {},
      route(router, 'chat.scm.result', { result: okResult('abc1234') }),
    );
    streams = applyStreamEffects(streams, route(router, 'chat.scm.result', { turnId: 't1' }));
    expect(resultsOf(streams)).toHaveLength(0);
  });

  it('lifts an idle stream so the card renders after a settled turn', () => {
    const router = new StreamEventRouter();
    const streams = applyStreamEffects(
      {},
      route(router, 'chat.scm.result', { turnId: 't1', result: okResult('abc1234') }),
    );
    expect(streams[KEY]!.status).not.toBe('idle');
  });

  it('asks the host to refresh the workspace — the branch and change set moved', () => {
    const router = new StreamEventRouter();
    const effects = route(router, 'chat.scm.result', {
      chatId: 'c1',
      turnId: 't1',
      result: okResult('abc1234'),
    });
    expect(effects.some((e) => e.op === 'invalidate' && e.resource === 'workspace')).toBe(true);
  });
});
