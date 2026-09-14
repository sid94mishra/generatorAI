// The `chat.scm.result` block: how it is recognised, how it reaches the
// transcript, and what the row says. The row component itself needs a
// device; everything it decides is asserted here.

import { describe, expect, it } from 'vitest';
import type { StreamBlock } from '@generatorai/client-core';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { blocksSignature, deriveTimeline, rowsEqual } from '../deriveTimeline';
import { asScmResultBlock, type ScmResultBlock } from '../scmResultBlock';
import { blockedReason, describeFlowResult, summarizeFlow } from '../../../scm/scmModel';

const readiness: RepoReadiness = {
  alias: '.',
  repoDir: '/w/app',
  isRepo: true,
  hasRemote: true,
  connected: true,
  branch: 'generatorai/cart',
  detached: false,
  defaultBranch: 'main',
  onDefaultBranch: false,
  dirty: false,
  changedFiles: 0,
  ahead: 1,
  behind: 0,
  hasUpstream: true,
  mergeInProgress: false,
  conflictedFiles: [],
  openPullRequest: null,
  can: { commit: true, push: true, pullRequest: true },
  reasons: {},
};

function result(over: Partial<ScmFlowResult> = {}): ScmFlowResult {
  return {
    status: 'ok',
    alias: '.',
    steps: [
      { id: 'commit', status: 'done' },
      { id: 'push', status: 'done' },
    ],
    commit: { sha: 'abc1234def', message: 'Fix the cart' },
    pushed: true,
    readiness,
    ...over,
  };
}

function block(over: Partial<ScmResultBlock> = {}): ScmResultBlock {
  return {
    type: 'scm_result',
    blockId: 9,
    chatId: 'chat-1',
    turnId: 'turn-3',
    result: result(),
    ...over,
  };
}

describe('asScmResultBlock', () => {
  it('recognises the documented shape', () => {
    expect(asScmResultBlock(block())).not.toBeNull();
  });

  it('refuses anything else, rather than rendering a broken row', () => {
    expect(asScmResultBlock(null)).toBeNull();
    expect(asScmResultBlock({ type: 'text', blockId: 1, content: 'hi' })).toBeNull();
    expect(asScmResultBlock({ type: 'scm_result', blockId: 1 })).toBeNull();
    expect(asScmResultBlock({ type: 'scm_result', blockId: 1, result: { status: 'weird' } })).toBeNull();
    expect(
      asScmResultBlock({ type: 'scm_result', blockId: 'nine', result: result() }),
    ).toBeNull();
  });
});

describe('the transcript', () => {
  const text: StreamBlock = { type: 'text', blockId: 1, content: 'Done.', isComplete: true } as StreamBlock;

  it('emits a row of its own, after the answer', () => {
    const rows = deriveTimeline([text, block() as unknown as StreamBlock], { active: false });
    expect(rows.map((r) => r.kind)).toEqual(['text', 'scm_result']);
    expect(rows[1]!.id).toBe('scm-9');
  });

  it('memoises on the block, so a settled row does not re-render', () => {
    const b = block();
    const a1 = { kind: 'scm_result' as const, id: 'scm-9', block: b };
    expect(rowsEqual(a1, { kind: 'scm_result', id: 'scm-9', block: b })).toBe(true);
    expect(rowsEqual(a1, { kind: 'scm_result', id: 'scm-9', block: block() })).toBe(false);
  });

  it('changes the derivation signature when the status changes', () => {
    const ok = blocksSignature([block() as unknown as StreamBlock]);
    const conflicted = blocksSignature([
      block({ result: result({ status: 'conflicts' }) }) as unknown as StreamBlock,
    ]);
    expect(ok).not.toBe(conflicted);
  });
});

describe('what the row says', () => {
  it('reads as one sentence with the PR at the end', () => {
    const flow = result({
      pullRequest: {
        provider: 'github',
        number: 12,
        url: 'https://example.test/pr/12',
        title: 'Fix the cart',
        state: 'open',
        head: 'generatorai/cart',
        base: 'main',
      },
    });
    expect(summarizeFlow(flow)).toBe('Committed abc1234 · pushed · PR #12');
    expect(describeFlowResult(flow).url).toBe('https://example.test/pr/12');
  });

  it('becomes the conflict card, with the files the merge stopped on', () => {
    const flow = result({
      status: 'conflicts',
      conflicts: { base: 'main', head: 'generatorai/cart', files: ['src/cart.ts'], mergeStarted: false },
    });
    const outcome = describeFlowResult(flow);
    expect(outcome.conflicts).toBe(true);
    expect(outcome.message).toBe('Merge conflicts in 1 file');
  });

  it('explains a blocked run instead of claiming a commit', () => {
    const flow = result({
      status: 'blocked',
      commit: undefined,
      pushed: false,
      steps: [{ id: 'readiness', status: 'blocked', detail: 'No git remote configured' }],
    });
    expect(blockedReason(flow)).toBe('No git remote configured');
    expect(describeFlowResult(flow).tone).toBe('warning');
  });
});
