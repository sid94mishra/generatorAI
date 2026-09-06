// ────────────────────────────────────────────────────────────────
// Review 5.1 — the tool-permission decision.
//
// The chat's permission mode was validated, saved, echoed back and shown as a
// live control in the web, terminal and mobile clients, and it decided
// nothing: `onPermissionRequest` was never assigned, so the adapter's approval
// callback fell through to allow every tool. A user who chose "Ask me" was
// watching an agent that was not asking.
//
// `decideToolPermission` is now the single answer to "what happens to a tool
// call the harness did not auto-allow", and `ChatManagementService`'s handler
// is built on it. These cases pin the policy: if one of them ever flips back
// to `allow`, the safety control has silently stopped holding again.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { decideToolPermission, buildToolPermissionPayload } from '../agentModePolicy.js';
import type { PermissionRequest } from '../../domain/ports/IAgentHarness.js';

describe('decideToolPermission (review 5.1)', () => {
  it('prompts for everything in "default" — the mode whose whole promise is asking', () => {
    for (const type of ['file_write', 'file_read', 'shell_exec', 'network', 'other'] as const) {
      expect(decideToolPermission('default', type)).toBe('prompt');
    }
  });

  it('in "acceptEdits" allows file work and still prompts for the rest', () => {
    expect(decideToolPermission('acceptEdits', 'file_write')).toBe('allow');
    expect(decideToolPermission('acceptEdits', 'file_read')).toBe('allow');
    // Accepting edits is not accepting arbitrary commands or network calls.
    expect(decideToolPermission('acceptEdits', 'shell_exec')).toBe('prompt');
    expect(decideToolPermission('acceptEdits', 'network')).toBe('prompt');
    expect(decideToolPermission('acceptEdits', 'other')).toBe('prompt');
  });

  it('allows everything only in "bypassPermissions", which is the explicit opt-out', () => {
    expect(decideToolPermission('bypassPermissions', 'shell_exec')).toBe('allow');
  });

  it('denies rather than prompts in "dontAsk", which must never block on a human', () => {
    expect(decideToolPermission('dontAsk', 'shell_exec')).toBe('deny');
  });

  it('prompts in plan mode, so a planning turn cannot quietly act', () => {
    expect(decideToolPermission('plan', 'file_write')).toBe('prompt');
  });
});

describe('buildToolPermissionPayload — what the approval card shows', () => {
  const base: PermissionRequest = {
    type: 'shell_exec',
    description: 'Run a shell command',
    details: { toolName: 'Bash', input: { command: 'rm -rf build' } },
  };

  it('names the tool and carries a readable summary of the input', () => {
    const payload = buildToolPermissionPayload(base, 'default');
    expect(payload.toolName).toBe('Bash');
    expect(payload.type).toBe('shell_exec');
    expect(payload.inputSummary).toContain('rm -rf build');
    expect(payload.permissionMode).toBe('default');
  });

  it('redacts secret-looking values so approving a call never prints a credential', () => {
    const payload = buildToolPermissionPayload(
      {
        type: 'network',
        description: 'Call an API',
        details: { toolName: 'Fetch', input: { url: 'https://api.example', apiKey: 'sk-live-123', token: 'abc' } },
      },
      'default',
    );
    expect(payload.inputSummary).not.toContain('sk-live-123');
    expect(payload.inputSummary).not.toContain('abc');
    expect(payload.inputSummary).toContain('[redacted]');
    // The non-secret part still has to be readable, or the user cannot judge.
    expect(payload.inputSummary).toContain('api.example');
  });

  it('falls back to the request type when the adapter sent no tool name', () => {
    const payload = buildToolPermissionPayload(
      { type: 'file_write', description: 'Write a file' },
      'default',
    );
    expect(payload.toolName).toBe('file_write');
  });
});
