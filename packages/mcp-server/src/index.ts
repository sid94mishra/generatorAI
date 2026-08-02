// ────────────────────────────────────────────────────────────────
// @generatorai/mcp-server — TOL-05 scaffold.
//
// Status: **groundwork only**. This package today contains:
//
//   - `toolAdapter.ts` — pure translation from our `CustomToolRegistry`
//     to the MCP `Tool` advertisement shape. Fully usable on its own.
//   - A placeholder `McpServerScaffold` that documents the wire
//     transport (streamable HTTP) we intend to implement next.
//
// The transport itself (HTTP request routing, session management, JSON-RPC
// framing) is deferred until we have at least one useful tool to expose
// through it. Adding it later means:
//
//   1. `pnpm add @modelcontextprotocol/sdk` to this package.
//   2. Replace `McpServerScaffold.start()` with an actual MCP Server
//      instance bound to an HTTP transport.
//   3. Wire `listTools` to `advertiseRegistry(registry)` and `callTool`
//      to `invokeRegisteredTool(registry, ...)`.
//
// Nothing about that future work requires changes outside this package —
// the registry contract + tool adapter stay identical.
// ────────────────────────────────────────────────────────────────

export {
  toMcpTool,
  advertiseRegistry,
  invokeRegisteredTool,
} from './toolAdapter.js';
export type { McpAdvertisedTool } from './toolAdapter.js';

import type { CustomToolRegistry } from '@generatorai/core';
import { advertiseRegistry, invokeRegisteredTool } from './toolAdapter.js';

export interface McpServerOptions {
  registry: CustomToolRegistry;
  /** Listen host (default '127.0.0.1'). */
  host?: string;
  /** Listen port (0 picks an ephemeral port). */
  port?: number;
  /** Logger callback; no-op by default. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Placeholder MCP server. `start()` is a no-op today — calling it logs
 * a warning that the server is not yet wired to a transport. The class
 * exposes the listTools / callTool shape the real implementation will
 * use so callers can rely on the interface now.
 */
export class McpServerScaffold {
  constructor(private readonly opts: McpServerOptions) {}

  /** Returns the MCP `Tool[]` advertisement for the registered tools. */
  listTools() {
    return advertiseRegistry(this.opts.registry);
  }

  /** Invoke a registered tool by name. Used by the eventual RPC dispatcher. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return invokeRegisteredTool(this.opts.registry, name, args);
  }

  /**
   * Start the MCP server. **Currently a no-op** — see the package-level
   * docstring above. Callers should treat a successful return as
   * "scaffolded" and not "ready to serve clients".
   */
  async start(): Promise<void> {
    this.opts.log?.(
      '[McpServerScaffold] start() called — MCP transport not yet implemented. ' +
      'See packages/mcp-server/src/index.ts for the integration TODO.',
    );
  }

  async stop(): Promise<void> {
    // no-op until transport is wired
  }
}
