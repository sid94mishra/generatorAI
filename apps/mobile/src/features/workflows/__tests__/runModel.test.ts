import { describe, expect, it } from 'vitest';

import { runTitle } from '@generatorai/client-core';

import { needsAttention, pollIntervalFor } from '../../../services/api/runActivity';
import { awaitsApproval, effectiveStageStatus, interruptOf, runControlsFor, stageControlsFor } from '../model/runModel';

describe('awaitsApproval', () => {
  it('only an awaiting_input stage gets approval buttons', () => {
    expect(awaitsApproval('awaiting_input')).toBe(true);
    // These need a person — but Retry / Resume, never Approve.
    for (const status of ['failed', 'paused']) {
      expect(needsAttention(status)).toBe(true);
      expect(awaitsApproval(status), status).toBe(false);
    }
    expect(awaitsApproval('running')).toBe(false);
  });
});

describe('interruptOf', () => {
  it('reads reason, then message, then prompt', () => {
    expect(interruptOf({ reason: 'Approve?', message: 'm', prompt: 'p' }).reason).toBe('Approve?');
    expect(interruptOf({ message: 'm', prompt: 'p' }).reason).toBe('m');
    expect(interruptOf({ prompt: 'p' }).reason).toBe('p');
  });

  it('carries the completion-review summary and kind', () => {
    const view = interruptOf({ kind: 'stage_completion_review', reason: 'Done', summary: 'Did X' });
    expect(view).toEqual({ reason: 'Done', summary: 'Did X', kind: 'stage_completion_review' });
  });

  it('never returns an empty reason', () => {
    for (const data of [undefined, null, 42, [], {}, '', { reason: '   ' }]) {
      expect(interruptOf(data).reason.length).toBeGreaterThan(0);
    }
    expect(interruptOf('Bare string').reason).toBe('Bare string');
    expect(interruptOf({ toolName: 'bash' }).tool).toBe('bash');
  });
});

describe('runControlsFor', () => {
  it('matches the server lifecycle', () => {
    expect(runControlsFor('running')).toEqual({ pause: true, resume: false, cancel: true, retry: false });
    expect(runControlsFor('paused')).toEqual({ pause: false, resume: true, cancel: true, retry: false });
    expect(runControlsFor('failed')).toEqual({ pause: false, resume: false, cancel: false, retry: true });
    expect(runControlsFor('completed')).toEqual({ pause: false, resume: false, cancel: false, retry: false });
    expect(runControlsFor('cancelling').cancel).toBe(false);
  });
});

describe('stageControlsFor', () => {

  it('offers Re-run from here (a fork) once the run is finished, and nothing that mutates it', () => {
    expect(stageControlsFor('paused', 'cancelled')).toEqual({ pause: false, resume: false, retry: false, skip: false, cancel: false, rerun: true });
    expect(stageControlsFor('failed', 'failed')).toMatchObject({ retry: true, rerun: true, cancel: false });
    expect(stageControlsFor('pending', 'completed').rerun).toBe(false);
  });

  it('lets a live run pause a running stage and skip a paused one', () => {
    expect(stageControlsFor('running', 'running')).toEqual({ pause: true, resume: false, retry: false, skip: false, cancel: true, rerun: false });
    expect(stageControlsFor('completed', 'running')).toEqual({ pause: false, resume: false, retry: false, skip: false, cancel: false, rerun: false });
    expect(stageControlsFor('paused', 'paused')).toMatchObject({ resume: true, retry: true, skip: true, cancel: true });
  });
});

describe('pollIntervalFor', () => {
  it('stops for terminal runs and slows down when the stream is live', () => {
    expect(pollIntervalFor('completed', false)).toBe(false);
    expect(pollIntervalFor('running', false)).toBe(5_000);
    expect(pollIntervalFor('running', true)).toBe(30_000);
    // Not terminal: still settling on its own.
    expect(pollIntervalFor('created', true)).toBe(30_000);
    expect(pollIntervalFor(undefined, true)).toBe(5_000);
  });
});

describe('runTitle', () => {
  it('drops the epoch suffix the server generates', () => {
    expect(runTitle('E2E Smoke Workflow - Run 1789237042303')).toBe('E2E Smoke Workflow');
    expect(runTitle('Nightly - Run 12')).toBe('Nightly - Run 12');
    expect(runTitle(null)).toBe('Workflow run');
    expect(runTitle('Run 1789237042303')).toBe('Run 1789237042303');
  });
});

describe('effectiveStageStatus', () => {
  it('shows a completed stage with an error in a failed run as failed', () => {
    expect(effectiveStageStatus({ status: 'completed', error: 'heartbeat stale' }, 'failed')).toBe('failed');
  });
  it('leaves clean or still-running cases alone', () => {
    expect(effectiveStageStatus({ status: 'completed', error: null }, 'failed')).toBe('completed');
    expect(effectiveStageStatus({ status: 'completed', error: 'x' }, 'completed')).toBe('completed');
    expect(effectiveStageStatus({ status: 'running' }, 'failed')).toBe('running');
  });
});
