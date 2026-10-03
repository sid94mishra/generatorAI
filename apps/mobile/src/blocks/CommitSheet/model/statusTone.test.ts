import { describe, expect, it } from 'vitest';
import { changeTone, domainStatus, domainStatusTone } from './statusTone';

describe('SCM / PR status tones from the shared status table', () => {
  it('keeps cancellation neutral and partial failure visible', () => {
    expect(domainStatusTone('permission', 'denied')).toBe('neutral');
    expect(domainStatusTone('automationExecution', 'partial')).toBe('danger');
    expect(domainStatusTone('ciCheck', 'cancelled')).toBe('neutral');
  });
  it('has a safe neutral fallback for a newer server value', () => {
    expect(domainStatus('workflowRun', 'constructor')).toBeNull();
    expect(domainStatusTone('workflowRun', 'future-status')).toBe('neutral');
  });
  it('uses the shared change colours', () => {
    expect(changeTone('modified')).toBe('warning');
    expect(changeTone('removed')).toBe('danger');
  });
});
