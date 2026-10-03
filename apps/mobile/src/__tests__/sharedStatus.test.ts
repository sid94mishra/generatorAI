import { describe, expect, it } from 'vitest';
import { domainStatus, domainStatusTone, runStatusTone, healthTone, changeTone, stepStatus } from '../theme/status';

describe('shared status adoption', () => {
  it('distinguishes a timer wait from a human gate', () => {
    expect(runStatusTone('waiting')).toBe('neutral');
    expect(runStatusTone('awaiting_input')).toBe('warning');
    expect(stepStatus('waiting').state).toBe('needs_you');
  });
  it('keeps cancellation neutral and partial failure visible', () => {
    expect(domainStatusTone('permission', 'denied')).toBe('neutral');
    expect(domainStatusTone('automationExecution', 'partial')).toBe('danger');
    expect(domainStatusTone('ciCheck', 'cancelled')).toBe('neutral');
  });
  it('has a safe neutral fallback for a newer server value', () => {
    expect(domainStatus('workflowRun', 'constructor')).toBeNull();
    expect(domainStatusTone('workflowRun', 'future-status')).toBe('neutral');
  });
  it('uses shared health/change colors', () => {
    expect(healthTone('codebase', 'cloning')).toBe('info');
    expect(changeTone('modified')).toBe('warning');
    expect(changeTone('removed')).toBe('danger');
  });
});
