import { describe, expect, it } from 'vitest';

import {
  awaitsApproval,
  effectiveStageStatus,
  interruptOf,
  pollIntervalFor,
  runControlsFor,
  runTitle,
  stageControlsFor,
} from '../components/runs/runModel';
import { needsAttention } from '../components/runs/statusStyle';

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
  it('offers Retry for failed and Resume for paused', () => {
    expect(stageControlsFor('failed', 'failed').retry).toBe(true);
    expect(stageControlsFor('paused', 'paused').resume).toBe(true);
    expect(stageControlsFor('sleeping', 'running').wake).toBe(true);
  });

  it('offers nothing but Retry once the run is finished', () => {
    expect(stageControlsFor('paused', 'cancelled')).toEqual({ retry: false, resume: false, wake: false, cancel: false });
    expect(stageControlsFor('completed', 'running')).toEqual({ retry: false, resume: false, wake: false, cancel: false });
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
