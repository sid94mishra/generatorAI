// ────────────────────────────────────────────────────────────────
// W10 — ACP stdio entry point.
//
// Launches a minimal GeneratorAI container (no HTTP server, no
// Express, no WebSockets) and bridges incoming ACP JSON-RPC to the
// chat harness via the AcpInboundAdapter.
//
// Usage:
//   node dist/acp-entry.js
//   # or in development:
//   tsx --env-file-if-exists=.env src/acp-entry.ts
//
// The process reads from stdin and writes to stdout. The ACP client
// launches this process and communicates over those streams.
// ────────────────────────────────────────────────────────────────

/* W10 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppConfigSchema } from '@generatorai/shared';
import { createContainer } from './composition-root.js';
import { AcpInboundAdapter } from './acp/AcpInboundAdapter.js';
import type { AcpHarnessBridge } from './acp/AcpInboundAdapter.js';
import type { IAgentHarness } from '@generatorai/core';

// ── .env loading (same as index.ts) ─────────────────────────────
{
  const __envDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = resolve(__envDir, '.env');
  if (existsSync(envFile)) {
    for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

async function main(): Promise<void> {
  // ── Parse config ─────────────────────────────────────────────
  const configResult = AppConfigSchema.safeParse(process.env);
  if (!configResult.success) {
    process.stderr.write(
      `[acp-entry] Invalid configuration: ${configResult.error.message}\n`,
    );
    process.exit(1);
  }
  const config = configResult.data;

  // ── Boot minimal container ───────────────────────────────────
  const container = await createContainer(config);

  // Wire process-level error handlers to avoid silent crashes
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[acp-entry] Uncaught exception: ${err.message}\n`);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[acp-entry] Unhandled rejection: ${msg}\n`);
  });

  // ── Build the harness bridge ─────────────────────────────────
  // Adapts IAgentHarness to the minimal AcpHarnessBridge interface.
  const harness: IAgentHarness = container.harness;
  const harnessBridge: AcpHarnessBridge = {
    async createConversation(params) {
      const conversationId = await harness.createConversation({
        conversationId: params.conversationId,
        model: params.model,
        workingDirectory: params.workingDirectory,
        // Tier-B: ACP sessions cannot gate every tool call at the provider
        // level (L16). Mark them accordingly so host boundaries enforce policy.
        harnessType: 'claude-agent', // default; client may override via model routing
      });
      return { conversationId };
    },

    async sendPrompt(conversationId, text) {
      await harness.sendPrompt(conversationId, text, [], {});
    },

    async abortConversation(conversationId) {
      await harness.abortConversation(conversationId);
    },
  };

  // ── Start the adapter ────────────────────────────────────────
  const adapter = new AcpInboundAdapter({
    harness: harnessBridge,
    eventBus: container.eventBus,
    serverName: 'GeneratorAI',
    serverVersion: '0.1.0',
    onExit: (code) => {
      container.shutdown().finally(() => process.exit(code));
    },
  });

  process.stderr.write('[acp-entry] ACP inbound adapter starting on stdio\n');
  adapter.start(process.stdin);
}

main().catch((err) => {
  process.stderr.write(`[acp-entry] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
