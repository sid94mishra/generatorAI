import { describe, expect, it } from 'vitest';
import { CustomToolRegistry } from '@generatorai/core';
import type { ToolDefinition } from '@generatorai/core';
import { advertiseRegistry, invokeRegisteredTool, toMcpTool } from '../toolAdapter.js';

// `packages/mcp-server` had zero test files, so `pnpm test` (and CI's
// `pnpm turbo test`) failed outright with Vitest's fatal "No test files
// found" — the exact same test-infra gap the arch-redesign review already
// found and fixed once for `apps/relay`. This is the first-ever coverage
// for this package's one piece of real logic: translating a harness-agnostic
// `ToolDefinition` into the MCP wire format.

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'read_file',
    description: 'Reads a file from the workspace',
    parametersSchema: { type: 'object', properties: { path: { type: 'string' } } },
    handler: async (args) => ({ echoed: args }),
    ...overrides,
  };
}

describe('toMcpTool', () => {
  it('carries name/description/inputSchema through unchanged', () => {
    const tool = makeTool();
    const mcp = toMcpTool(tool);
    expect(mcp.name).toBe('read_file');
    expect(mcp.description).toBe('Reads a file from the workspace');
    expect(mcp.inputSchema).toBe(tool.parametersSchema);
  });

  it('flags a tool with only file_read as readOnlyHint, not destructiveHint', () => {
    const mcp = toMcpTool(makeTool({ requiredPermissions: [{ kind: 'file_read' }] }));
    expect(mcp.annotations?.readOnlyHint).toBe(true);
    expect(mcp.annotations?.destructiveHint).toBeUndefined();
  });

  it('flags a tool needing file_write as destructiveHint, not readOnlyHint', () => {
    const mcp = toMcpTool(makeTool({ requiredPermissions: [{ kind: 'file_write' }] }));
    expect(mcp.annotations?.destructiveHint).toBe(true);
    expect(mcp.annotations?.readOnlyHint).toBeUndefined();
  });

  it('flags a tool needing shell_exec as destructiveHint', () => {
    const mcp = toMcpTool(makeTool({ requiredPermissions: [{ kind: 'shell_exec' }] }));
    expect(mcp.annotations?.destructiveHint).toBe(true);
  });

  it('leaves both hints undefined for a tool declaring no permissions', () => {
    const mcp = toMcpTool(makeTool({ requiredPermissions: undefined }));
    expect(mcp.annotations?.readOnlyHint).toBeUndefined();
    expect(mcp.annotations?.destructiveHint).toBeUndefined();
  });

  it('does not call file_read-plus-something-else "read only"', () => {
    const mcp = toMcpTool(
      makeTool({ requiredPermissions: [{ kind: 'file_read' }, { kind: 'network' }] }),
    );
    expect(mcp.annotations?.readOnlyHint).toBeUndefined();
  });
});

describe('advertiseRegistry', () => {
  it('advertises every tool in a REAL CustomToolRegistry, preserving registration order', () => {
    const registry = new CustomToolRegistry();
    registry.register(makeTool({ name: 'first' }));
    registry.register(makeTool({ name: 'second', requiredPermissions: [{ kind: 'shell_exec' }] }));

    const advertised = advertiseRegistry(registry);
    expect(advertised.map((t) => t.name)).toEqual(['first', 'second']);
    expect(advertised[1]?.annotations?.destructiveHint).toBe(true);
  });

  it('returns an empty list for an empty registry', () => {
    expect(advertiseRegistry(new CustomToolRegistry())).toEqual([]);
  });
});

describe('invokeRegisteredTool', () => {
  it('invokes the registered handler with the given args and returns its result', async () => {
    const registry = new CustomToolRegistry();
    registry.register(makeTool({ handler: async (args) => ({ doubled: (args['n'] as number) * 2 }) }));

    const result = await invokeRegisteredTool(registry, 'read_file', { n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });

  it('throws a clear error for a tool name that was never registered', async () => {
    const registry = new CustomToolRegistry();
    await expect(invokeRegisteredTool(registry, 'nonexistent', {})).rejects.toThrow(
      "MCP: tool 'nonexistent' not registered",
    );
  });
});
