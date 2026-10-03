import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_TOOL_POLICY } from '@generatorai/shared';

import { capabilityCounts, mcpNames, runtimeLines, toolRows, warningText } from './capabilitySummaryModel';

const projection = {
  toolPolicy: { allow: [], deny: [], groups: { ...DEFAULT_AGENT_TOOL_POLICY } },
  skills: { ids: ['a', 'b'], names: ['code-generation', 'test-generation'], directories: [], disabledNames: [], refs: [] },
  mcpServers: { GitHub: {}, Brave: {} },
};

describe('CapabilitySummary model', () => {
  it('writes the runtime lines from what is set', () => {
    expect(runtimeLines({ harnessType: 'claude-agent', model: 'claude-sonnet-5', reasoningEffort: 'medium', maxTurns: 40 })).toEqual({
      title: 'Claude Code · claude-sonnet-5',
      detail: 'effort medium · 40 turns',
    });
    expect(runtimeLines({})).toEqual({ title: null, detail: null });
  });
  it('lists tools, MCP names and the compact counts', () => {
    expect(toolRows(DEFAULT_AGENT_TOOL_POLICY).filter((t) => t.on).map((t) => t.key)).toEqual(['fileRead', 'fileWrite', 'shell', 'web', 'widgets', 'browser']);
    expect(mcpNames(projection)).toEqual(['Brave', 'GitHub']);
    expect(capabilityCounts(projection)).toBe('6 tools · 2 skills · 2 MCP');
  });
  it('words warnings', () => {
    expect(warningText({ code: 'MCP_SERVER_NEEDS_CONFIGURATION', params: { id: 'brave' } })).toBe('MCP server brave needs a key.');
    expect(warningText({ code: 'TEAM_AGENT_DISABLED', params: { ref: 'global:x' } })).toBe('Agent global:x is disabled.');
  });
});
