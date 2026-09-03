// ────────────────────────────────────────────────────────────────
// W10 — ACP stdio entry point.
//
// Launches a GeneratorAI container (no HTTP server, no Express, no
// WebSockets) and serves ACP over stdin/stdout via AcpInboundAdapter.
//
// Usage:
//   node dist/acp-entry.js
//   # or in development:
//   tsx --env-file-if-exists=.env src/acp-entry.ts
//
// The bridge below deliberately goes through `ChatManagementService` —
// the SAME service `POST /api/chats/:id/prompt` uses. That is what makes
// streaming work at all: harness events only reach the EventBus because
// `ChatManagementService.sendPrompt` subscribes to the harness with
// `session.conversationId` and re-emits on `chat.sessionId`. An adapter
// that talked to `IAgentHarness` directly (as this file used to) would
// bypass that hop and observe nothing — plus lose the transcript,
// plan/question gates and tool-call metadata that live in that service.
//
// Because the two ids differ, `createSession` returns BOTH: `chatId` for
// prompting and `eventSessionId` for subscribing. See AcpSessionHandle.
// ────────────────────────────────────────────────────────────────

/* W10 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { AppConfigSchema, isPlanAction } from '@generatorai/shared';
import type { HarnessConfig } from '@generatorai/shared';
import { createContainer } from './composition-root.js';
import { AcpInboundAdapter } from './acp/AcpInboundAdapter.js';
import type { AcpHarnessBridge } from './acp/AcpInboundAdapter.js';

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

/**
 * Optional operator override for which provider runs ACP sessions.
 *
 * `HarnessConfig.harnessType` is documented as "omit to route by `model`,
 * falling back to the server's primary provider". This file used to hardcode
 * `'claude-agent'` under the comment "client may override via model routing",
 * which was false twice over: ACP `session/new` carries no model, and pinning
 * the type is precisely what DISABLES model routing. So: honour an explicit
 * env override if the operator set one, otherwise leave it unset and let the
 * server's normal routing pick — the same thing the HTTP path does.
 */
function acpHarnessType(): HarnessConfig['harnessType'] | undefined {
  const raw = process.env['GENERATORAI_ACP_HARNESS_TYPE'];
  return raw === 'copilot' || raw === 'claude-agent' ? raw : undefined;
}

/** Optional operator override for the model ACP sessions run on. */
function acpModel(): string | undefined {
  const raw = process.env['GENERATORAI_ACP_MODEL']?.trim();
  return raw ? raw : undefined;
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

  // ── Boot container ───────────────────────────────────────────
  const container = await createContainer(config);

  // Wire process-level error handlers to avoid silent crashes. Note these
  // write to stderr — stdout is the ACP wire and must carry nothing but
  // newline-delimited JSON-RPC.
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[acp-entry] Uncaught exception: ${err.message}\n`);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[acp-entry] Unhandled rejection: ${msg}\n`);
  });

  const chats = container.chatManagementService;
  const sessions = container.sessionService;
  const harness = container.harness;

  // ── Build the bridge over the container ──────────────────────
  const bridge: AcpHarnessBridge = {
    async createSession({ cwd, additionalDirectories }) {
      const harnessType = acpHarnessType();
      const model = acpModel();
      const chat = await chats.createChat({
        name: `ACP ${basename(cwd) || cwd}`,
        // ACP clients edit THEIR checkout. Binding the chat to `cwd` as a
        // local folder (and disabling worktrees) is what stops GeneratorAI
        // from silently doing the work in a copy the editor cannot see.
        gitRepositories: [
          { url: cwd, alias: basename(cwd) || 'workspace' },
          ...(additionalDirectories ?? []).map((dir) => ({
            url: dir,
            alias: basename(dir) || dir,
          })),
        ],
        createWorktree: false,
        ...(model ? { model } : {}),
        harnessConfig: {
          streaming: true,
          ...(model ? { model } : {}),
          ...(harnessType ? { harnessType } : {}),
        },
      });
      return { chatId: chat.id, eventSessionId: chat.sessionId };
    },

    async sendPrompt(chatId, text) {
      await chats.sendPrompt(chatId, text);
    },

    async cancelTurn(chatId) {
      await chats.cancelTurn(chatId);
    },

    async releaseSession(handle) {
      // Drop the live SDK conversation so it does not leak for the lifetime of
      // the process. The chat + transcript rows stay in the database on
      // purpose: a client disconnect (editor restart) must not destroy
      // history, so this is `deleteConversation`, NOT `chats.deleteChat`,
      // which would also tear down the workspace.
      const session = await sessions.getSession(handle.eventSessionId).catch(() => null);
      if (session?.conversationId) {
        await harness.deleteConversation(session.conversationId);
      }
    },

    async decidePlan(chatId, planId, decision) {
      // The adapter already refuses any optionId it did not advertise, but the
      // option ids come off the wire, so re-narrow to a real PlanAction here
      // rather than casting an arbitrary string into the service.
      const action = decision.action;
      await chats.decidePlan(chatId, planId, {
        approved: decision.approved,
        ...(action && isPlanAction(action) ? { action } : {}),
      });
    },
  };

  // ── Start the adapter on stdio ───────────────────────────────
  const adapter = new AcpInboundAdapter({
    bridge,
    eventBus: container.eventBus,
    agentName: 'GeneratorAI',
    agentVersion: '0.1.0',
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  );

  process.stderr.write('[acp-entry] ACP inbound adapter starting on stdio\n');
  const connection = adapter.start(stream);

  // stdin EOF / transport close ends the process. `adapter.stop()` releases
  // every session (EventBus unsubscribe + harness.deleteConversation) before
  // the container shuts down.
  await connection.closed.catch(() => undefined);
  await adapter.stop();
  await container.shutdown();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[acp-entry] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
