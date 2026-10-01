import { expect, it } from 'vitest';
import { transcriptStepStatus } from '../transcript/stepStatus.js';
it('distinguishes a transcript human gate from a queued call or successful result', () => {
  expect(transcriptStepStatus('waiting')).toEqual({ state: 'needs_you' });
  expect(transcriptStepStatus('pending')).toEqual({ state: 'queued' });
  expect(transcriptStepStatus('done')).toEqual({ state: 'succeeded', label: 'Done' });
  expect(transcriptStepStatus('running')).toEqual({ state: 'running' });
  expect(transcriptStepStatus('failed')).toEqual({ state: 'failed' });
});
