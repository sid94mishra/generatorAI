// MG-13 — the SCM flow's outcome stamped on the workspace metadata.

import { describe, expect, it, vi } from 'vitest';
import type { ScmFlowResult } from '@generatorai/shared';
import { activityScmFields, readScmOutcome, recordScmOutcome, scmOutcomeFrom } from '../routes/scmOutcome.js';

const AT = new Date('2026-01-05T00:00:00Z');

function result(extra: Partial<ScmFlowResult>): ScmFlowResult {
  return { status: 'ok', alias: '.', steps: [], readiness: {} as never, ...extra };
}

describe('scm outcome', () => {
  it('keeps nothing when the flow neither committed nor opened a PR', () => {
    expect(scmOutcomeFrom(result({ pushed: true }), AT)).toBeNull();
  });

  it('records the commit and PR, keeping an earlier PR across a later push', async () => {
    let stored: Record<string, unknown> = { other: 1 };
    const repo = {
      findById: vi.fn(async () => ({ id: 'ws', status: 'active', metadata: stored }) as never),
      updateStatus: vi.fn(async (_id: string, _status: string, updates?: { metadata?: Record<string, unknown> }) => {
        stored = updates?.metadata ?? stored;
      }),
    };
    const pr = { provider: 'github', number: 7, url: 'u', title: 't', state: 'open', head: 'h', base: 'b' } as const;
    await recordScmOutcome(repo, 'ws', scmOutcomeFrom(result({ branch: 'x', commit: { sha: 's1', message: 'm' }, pullRequest: pr }), AT)!);
    await recordScmOutcome(repo, 'ws', scmOutcomeFrom(result({ branch: 'x', commit: { sha: 's2', message: 'm' } }), new Date('2026-01-06T00:00:00Z'))!);
    expect(stored['other']).toBe(1);
    expect(readScmOutcome(stored)).toEqual({
      at: '2026-01-06T00:00:00.000Z',
      branch: 'x',
      commit: { sha: 's2' },
      pullRequest: { number: 7, url: 'u' },
    });
  });

  it('attaches the outcome only to work that began before it', () => {
    const outcome = { at: AT.toISOString(), branch: 'b', commit: { sha: 's' }, pullRequest: { number: 1, url: 'u' } };
    expect(activityScmFields(outcome, AT.getTime() - 1)).toEqual({ pullRequest: { number: 1, url: 'u' }, commit: { branch: 'b', sha: 's' } });
    expect(activityScmFields(outcome, AT.getTime() + 1)).toEqual({});
    expect(activityScmFields(null, 0)).toEqual({});
    expect(readScmOutcome({ scmOutcome: { at: 'nope' } })).toBeNull();
  });
});
