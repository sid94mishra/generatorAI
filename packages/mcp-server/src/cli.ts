#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CLI entrypoint — boots a `GeneratorAI` SDK instance (packages/sdk, which
// embeds the full core/db/harness graph in-process) and serves it over MCP
// stdio, exactly the way a bundled MCP server (`npx @modelcontextprotocol/
// server-x`) is spawned. This is what makes `packages/mcp-server` reachable
// from an external MCP client instead of being dead code with no importer.
//
// Env vars (all optional; sensible local defaults):
//   GENERATORAI_MCP_HARNESS    'copilot' | 'claude-agent' | … (default 'claude-agent')
//   GENERATORAI_MCP_DB         sqlite file path (default './generatorai.db')
//   GENERATORAI_MCP_ARTIFACTS  artifacts dir (default './artifacts')
//   GENERATORAI_MCP_TEMPLATES  templates dir (default './templates')
// ────────────────────────────────────────────────────────────────

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGeneratorAI, type HarnessSelection } from '@generatorai/sdk';
import { GeneratorAiMcpServer } from './server.js';

async function main(): Promise<void> {
  const harness = (process.env['GENERATORAI_MCP_HARNESS'] ?? 'claude-agent') as HarnessSelection;

  // stdout is the MCP wire — every diagnostic goes to stderr instead.
  const log = (msg: string, meta?: Record<string, unknown>): void => {
    process.stderr.write(`${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`);
  };

  const ai = await createGeneratorAI({
    harness,
    database: process.env['GENERATORAI_MCP_DB'] ?? './generatorai.db',
    artifactsDir: process.env['GENERATORAI_MCP_ARTIFACTS'] ?? './artifacts',
    templatesDir: process.env['GENERATORAI_MCP_TEMPLATES'] ?? './templates',
    logger: { level: 'warn' },
  });

  const server = new GeneratorAiMcpServer({ ai, log });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('[generatorai-mcp-server] ready');

  const shutdown = async (): Promise<void> => {
    log('[generatorai-mcp-server] shutting down');
    await server.close().catch(() => { /* best effort */ });
    await ai.shutdown().catch(() => { /* best effort */ });
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  process.stderr.write(`[generatorai-mcp-server] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
