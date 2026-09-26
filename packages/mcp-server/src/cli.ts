#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// `generatorai-mcp` — serve a RUNNING GeneratorAI server over MCP stdio
// (remote mode, P04 WP-4.4; W-58: the embedded core is gone).
//
//   generatorai-mcp pair <code> [--name <device name>]
//       Redeem a pairing code from `generatorai device invite --platform mcp
//       --scopes exec:agent,read:workflows[,write:workflows]` (or Settings →
//       Devices → Pair a device). The device key goes to the OS-backed vault.
//   generatorai-mcp [serve]
//       Serve over stdio, the way a bundled MCP server is spawned.
//
// Env vars:
//   GENERATORAI_URL             the server (default: the one paired with); a
//                               short pairing code is resolved against it
//   GENERATORAI_MCP_CONFIG_DIR  where the pairing lives (default ~/.generatorai/mcp)
// ────────────────────────────────────────────────────────────────

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GeneratorAiMcpServer } from './server.js';
import { createMcpRuntime, loadConnection, pairMcp, remoteFacade } from './remote.js';

// stdout is the MCP wire — every diagnostic goes to stderr instead.
const log = (msg: string, meta?: Record<string, unknown>): void => {
  process.stderr.write(`${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`);
};

async function pair(args: string[]): Promise<void> {
  const code = args.find((a) => !a.startsWith('--'));
  if (!code) throw new Error('Usage: generatorai-mcp pair <pairing code or URL> [--name <device name>]');
  const nameAt = args.indexOf('--name');
  const name = nameAt >= 0 ? args[nameAt + 1] : undefined;
  const { consent, deviceId } = await pairMcp(code, name ? { name } : {});
  log(`[generatorai-mcp] paired with "${consent.serverName}" (${consent.endpoint}) as device ${deviceId ?? '?'}`);
  log(`[generatorai-mcp] scopes: ${consent.requestedScopes.join(', ') || 'the server default for mcp'}`);
}

async function serve(): Promise<void> {
  const connection = loadConnection();
  if (!connection) {
    throw new Error('Not paired. Run `generatorai device invite --platform mcp` on the server, then `generatorai-mcp pair <code>`.');
  }
  const runtime = createMcpRuntime(connection, process.env['GENERATORAI_URL'] ?? connection.endpoint);
  const server = new GeneratorAiMcpServer({ ai: remoteFacade(runtime), log });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`[generatorai-mcp] ready (${connection.serverName ?? connection.endpoint})`);

  const shutdown = async (): Promise<void> => {
    log('[generatorai-mcp] shutting down');
    await server.close().catch(() => {
      /* best effort */
    });
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'pair') return pair(rest);
  if (!command || command === 'serve') return serve();
  throw new Error(`Unknown command "${command}" (use: pair <code> | serve)`);
}

main().catch((err) => {
  process.stderr.write(`[generatorai-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
