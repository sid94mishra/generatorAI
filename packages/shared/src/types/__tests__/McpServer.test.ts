// ────────────────────────────────────────────────────────────────
// mcpStartupWarnings — SDK `system/init` mcp_servers[] → visible
// harness.warning events (W48).
//
// `feature-skills-agents-mcp.md` claimed a failed MCP server maps to a
// visible event; nothing actually called this before. This is the mapping
// half — see packages/agent-harness-providers/src/providers/claude-agent/
// event-mapper.ts's `case 'init':` for the call site that still needs to
// push these onto the event stream (that file is out of scope here).
// ────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { mcpStartupWarnings, redactMcpValues, MCP_REDACTED_VALUE } from '../McpServer.js';

describe('mcpStartupWarnings', () => {
  it('turns a failed server into a visible MCP_SERVER_FAILED warning', () => {
    const warnings = mcpStartupWarnings([{ name: 'github', status: 'failed', error: 'ENOENT: npx not found' }]);
    expect(warnings).toEqual([
      {
        code: 'MCP_SERVER_FAILED',
        message: 'MCP server "github" failed to start: ENOENT: npx not found. Its tools are unavailable for this turn.',
        details: { server: 'github', status: 'failed', error: 'ENOENT: npx not found' },
      },
    ]);
  });

  it('omits the error clause when the SDK reports no error text', () => {
    const warnings = mcpStartupWarnings([{ name: 'jira', status: 'failed' }]);
    expect(warnings[0]?.message).toBe('MCP server "jira" failed to start. Its tools are unavailable for this turn.');
  });

  it('turns a needs-auth server into a visible MCP_SERVER_NEEDS_AUTH warning', () => {
    const warnings = mcpStartupWarnings([{ name: 'slack', status: 'needs-auth' }]);
    expect(warnings).toEqual([
      {
        code: 'MCP_SERVER_NEEDS_AUTH',
        message: 'MCP server "slack" needs authentication. Add its credentials in Settings → MCP Servers.',
        details: { server: 'slack', status: 'needs-auth' },
      },
    ]);
  });

  it('does not warn about a connected server', () => {
    expect(mcpStartupWarnings([{ name: 'github', status: 'connected' }])).toEqual([]);
  });

  it('does not warn about pending (transient) or disabled (the user\'s own choice)', () => {
    expect(mcpStartupWarnings([
      { name: 'a', status: 'pending' },
      { name: 'b', status: 'disabled' },
    ])).toEqual([]);
  });

  it('handles multiple servers independently, and tolerates undefined/malformed input', () => {
    const warnings = mcpStartupWarnings([
      { name: 'ok', status: 'connected' },
      { name: 'broken', status: 'failed', error: 'timeout' },
      null as never,
      { status: 'failed' } as never, // missing name — skipped, not thrown
    ]);
    expect(warnings.map((w) => w.details.server)).toEqual(['broken']);
    expect(mcpStartupWarnings(undefined)).toEqual([]);
  });
});

describe('redactMcpValues', () => {
  it('replaces every value with the mask, keeping the keys', () => {
    expect(redactMcpValues({ Authorization: 'Bearer live-token', 'X-Api-Key': 'k' })).toEqual({
      Authorization: MCP_REDACTED_VALUE,
      'X-Api-Key': MCP_REDACTED_VALUE,
    });
  });

  it('returns undefined for undefined, not an empty object', () => {
    expect(redactMcpValues(undefined)).toBeUndefined();
  });
});
