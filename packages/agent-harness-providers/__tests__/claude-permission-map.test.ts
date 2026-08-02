// ────────────────────────────────────────────────────────────────
// claude-permission-map.test.ts — HITL parity for the Claude provider
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { mapClaudeToolNameToDomainType } from '../src/providers/claude-agent/permission-map.js';

describe('mapClaudeToolNameToDomainType (HITL-06 Claude parity)', () => {
  it('maps file-write tools', () => {
    expect(mapClaudeToolNameToDomainType('Write')).toBe('file_write');
    expect(mapClaudeToolNameToDomainType('Edit')).toBe('file_write');
    expect(mapClaudeToolNameToDomainType('MultiEdit')).toBe('file_write');
    expect(mapClaudeToolNameToDomainType('NotebookEdit')).toBe('file_write');
  });

  it('maps file-read tools', () => {
    expect(mapClaudeToolNameToDomainType('Read')).toBe('file_read');
    expect(mapClaudeToolNameToDomainType('Glob')).toBe('file_read');
    expect(mapClaudeToolNameToDomainType('Grep')).toBe('file_read');
    expect(mapClaudeToolNameToDomainType('LS')).toBe('file_read');
  });

  it('maps shell tools', () => {
    expect(mapClaudeToolNameToDomainType('Bash')).toBe('shell_exec');
    expect(mapClaudeToolNameToDomainType('BashOutput')).toBe('shell_exec');
    expect(mapClaudeToolNameToDomainType('KillShell')).toBe('shell_exec');
  });

  it('maps network tools', () => {
    expect(mapClaudeToolNameToDomainType('WebFetch')).toBe('network');
    expect(mapClaudeToolNameToDomainType('WebSearch')).toBe('network');
  });

  it('is case-insensitive', () => {
    expect(mapClaudeToolNameToDomainType('bash')).toBe('shell_exec');
    expect(mapClaudeToolNameToDomainType('WRITE')).toBe('file_write');
    expect(mapClaudeToolNameToDomainType('read')).toBe('file_read');
  });

  it('falls through unknown tools to "other" (safe HITL-gated default)', () => {
    expect(mapClaudeToolNameToDomainType('mcp__generatorai-tools__save_scratchpad')).toBe('other');
    expect(mapClaudeToolNameToDomainType('SomeCustomTool')).toBe('other');
    expect(mapClaudeToolNameToDomainType('')).toBe('other');
  });
});
