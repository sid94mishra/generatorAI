import { describe, expect, it } from 'vitest';

import { connectionProblemCopy } from '../services/auth/connectionProblem';

describe('connection problem copy (MD-202)', () => {
  it('asks to pair again for a changed certificate and a plain-HTTP pairing', () => {
    expect(connectionProblemCopy('certificate-changed', 'X')).toMatchObject({ title: 'This server’s identity changed — pair again', action: 'pair' });
    expect(connectionProblemCopy('insecure-endpoint', 'X')).toMatchObject({ action: 'pair' });
  });

  it('points at the platform switch for a denied Local Network', () => {
    const copy = connectionProblemCopy('local-network-denied', 'Settings › Privacy & Security › Local Network');
    expect(copy.action).toBe('settings');
    expect(copy.body).toContain('Settings › Privacy & Security › Local Network');
  });
});
