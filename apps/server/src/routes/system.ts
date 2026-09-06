// ────────────────────────────────────────────────────────────────
// System Routes — System-level artifacts (skills, prompts, agents) + MCP
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COMPUTER_USE_DISABLE_TOKENS,
  COMPUTER_USE_KILL_SWITCH_ENV,
  COMPUTER_USE_SKILL_ID,
  McpServerBodySchema,
  SystemMcpPrefsBodySchema,
  mcpCredentialNamespace,
} from '@generatorai/shared';
import { toMcpServerEntry } from '@generatorai/core';
import type { Container } from '../composition-root.js';
import { readComputerUsePreferences, writeComputerUsePreferences } from '../settings/computerUse.js';
import {
  readAudioPreferences,
  writeAudioPreferences,
  STT_ENGINE_CHOICES,
  TEXT_FORMATTER_CHOICES,
  MIN_ENDPOINT_MS,
  MAX_ENDPOINT_MS,
} from '../settings/audio.js';
import {
  nemotronModelStatus,
  downloadNemotronModel,
  deleteNemotronModel,
  NEMOTRON_REPO,
} from '@generatorai/core';
import {
  readWorkspaceRetentionPreferences,
  writeWorkspaceRetentionPreferences,
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
} from '../settings/workspaceRetention.js';

const computerUseSchema = z.object({
  enabled: z.boolean(),
  allowSynthetic: z.boolean().optional(),
});

/** True when an operator has hard-disabled the feature via the environment. */
function killSwitchEngaged(): boolean {
  const raw = process.env[COMPUTER_USE_KILL_SWITCH_ENV];
  return raw !== undefined && COMPUTER_USE_DISABLE_TOKENS.includes(raw.trim().toLowerCase());
}

export function createSystemRoutes(container: Container): Router {
  const router = Router();
  const { systemArtifactService, artifactCatalog, mcpSettingsStore, mcpCredentialVault } = container;
  const dataDir = dirname(resolve(container.config.dbPath));

  // GET /system/artifacts — List all system artifacts
  router.get('/artifacts', async (req, res, next) => {
    try {
      const type = req.query['type'] as string | undefined;
      const validTypes = ['agent', 'prompt', 'skill'];
      const configType = type && validTypes.includes(type) ? type as 'agent' | 'prompt' | 'skill' : undefined;
      const artifacts = await systemArtifactService.listSystemArtifacts(configType);
      res.json(artifacts);
    } catch (err) {
      next(err);
    }
  });

  // GET /system/artifacts/:id — Get system artifact content
  router.get('/artifacts/:id', async (req, res, next) => {
    try {
      const content = await systemArtifactService.getSystemArtifactContent(String(req.params['id']));
      res.json({ content });
    } catch (err) {
      next(err);
    }
  });

  // GET /system/mcp-servers — bundled catalog + custom servers (Settings →
  // MCP Servers), merged by ArtifactCatalog and redacted by toMcpServerEntry:
  // a credential value never appears here, only the mask + which names are
  // stored (`hasCredentials`), and each entry carries `needsConfiguration`
  // when a required input/credential is still missing (W48).
  router.get('/mcp-servers', async (req, res, next) => {
    try {
      const servers = await artifactCatalog.listMcpServers();
      res.json(servers.map(toMcpServerEntry));
    } catch (err) {
      next(err);
    }
  });

  // POST /system/mcp-servers/custom — add a server from Settings → MCP
  // Servers. Persisted server-side via McpSettingsStore (W48) — this used to
  // be the endpoint that never existed, so the Settings form only ever wrote
  // to the browser's localStorage and no harness config ever saw it.
  router.post('/mcp-servers/custom', async (req, res, next) => {
    try {
      const parsed = McpServerBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid MCP server' } });
        return;
      }
      const { name, description, serverType, url, command, args, timeoutMs, enabled, headers, env } = parsed.data;
      const rec = mcpSettingsStore.addCustom({ name, description, serverType, url, command, args, timeoutMs, enabled });
      if ((headers && Object.keys(headers).length) || (env && Object.keys(env).length)) {
        const refs = await mcpCredentialVault.save(mcpCredentialNamespace('custom', rec.id), { headers, env });
        mcpSettingsStore.updateCustom(rec.id, { credentialRefs: refs });
      }
      const servers = await artifactCatalog.listMcpServers();
      const created = servers.find((s) => s.id === rec.id);
      res.status(201).json(created ? toMcpServerEntry(created) : rec);
    } catch (err) {
      next(err);
    }
  });

  // PUT /system/mcp-servers/custom/:id — replace a custom server. Same
  // full-desired-set contract as the project MCP routes: an omitted stored
  // credential name is deleted, and the redaction marker keeps it.
  router.put('/mcp-servers/custom/:id', async (req, res, next) => {
    try {
      const parsed = McpServerBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid MCP server' } });
        return;
      }
      const id = String(req.params['id']);
      const existing = mcpSettingsStore.getCustom(id);
      if (!existing) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Custom MCP server "${id}" not found` } });
        return;
      }
      const { name, description, serverType, url, command, args, timeoutMs, enabled, headers, env } = parsed.data;
      const refs = await mcpCredentialVault.save(mcpCredentialNamespace('custom', id), { headers, env }, existing.credentialRefs);
      mcpSettingsStore.updateCustom(id, { name, description, serverType, url, command, args, timeoutMs, enabled, credentialRefs: refs });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /system/mcp-servers/custom/:id
  router.delete('/mcp-servers/custom/:id', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      await mcpCredentialVault.remove(mcpCredentialNamespace('custom', id));
      const removed = mcpSettingsStore.removeCustom(id);
      if (!removed) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Custom MCP server "${id}" not found` } });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // PUT /system/mcp-servers/system/:id — per-bundled-server prefs: on/off,
  // `{{input}}` values (e.g. the Filesystem allowed directory, the Postgres
  // connection string) and credentials (e.g. GITHUB_PERSONAL_ACCESS_TOKEN).
  // This is the endpoint that turns a bundled server which "ships enabled"
  // but has an unfilled example value into one that actually works.
  router.put('/mcp-servers/system/:id', async (req, res, next) => {
    try {
      const parsed = SystemMcpPrefsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid MCP server preferences' } });
        return;
      }
      const id = String(req.params['id']);
      const { enabled, inputs, headers, env } = parsed.data;
      const existing = mcpSettingsStore.getSystemPrefs(id);
      const patch: { enabled?: boolean; inputs?: Record<string, string>; credentialRefs?: typeof existing.credentialRefs } = {};
      if (enabled !== undefined) patch.enabled = enabled;
      if (inputs !== undefined) patch.inputs = inputs;
      if (headers !== undefined || env !== undefined) {
        patch.credentialRefs = await mcpCredentialVault.save(mcpCredentialNamespace('system', id), { headers, env }, existing.credentialRefs ?? {});
      }
      mcpSettingsStore.setSystemPrefs(id, patch);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // ── Audio (speech-to-text / text-to-speech) ────────────────────

  const audioSchema = z.object({
    sttEngine: z.enum(STT_ENGINE_CHOICES).optional(),
    textFormatter: z.enum(TEXT_FORMATTER_CHOICES).optional(),
    endpointSilenceMs: z.number().int().min(MIN_ENDPOINT_MS).max(MAX_ENDPOINT_MS).optional(),
    interimResults: z.boolean().optional(),
    ttsEnabled: z.boolean().optional(),
    ttsVoice: z.string().min(1).max(64).optional(),
    ttsSpeed: z.number().min(0.5).max(2).optional(),
  });

  // A download runs in the server, not in the request that started it: it is
  // ~790MB and would blow any sensible HTTP timeout. The request kicks it off
  // and returns; the UI polls GET /system/audio/model for progress.
  interface ModelDownload {
    promise: Promise<void>;
    progress: number;
    error?: string;
    controller: AbortController;
  }
  let modelDownload: ModelDownload | null = null;

  router.get('/audio', (_req, res, next) => {
    try {
      res.json({
        ...readAudioPreferences(dataDir),
        engines: STT_ENGINE_CHOICES,
        formatters: TEXT_FORMATTER_CHOICES,
        minEndpointMs: MIN_ENDPOINT_MS,
        maxEndpointMs: MAX_ENDPOINT_MS,
        // An operator override beats the UI, so say when one is in force
        // rather than showing a control that silently does nothing.
        engineLockedByEnv: process.env['GENERATORAI_STT_ENGINE'] ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/audio', (req, res, next) => {
    const parsed = audioSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    try {
      res.json(writeAudioPreferences(dataDir, parsed.data));
    } catch (err) {
      next(err);
    }
  });

  // GET /system/audio/model — is the Nemotron model downloaded, and how far
  // along is a download if one is running?
  router.get('/audio/model', async (_req, res, next) => {
    try {
      const status = await nemotronModelStatus();
      res.json({
        ...status,
        downloading: modelDownload !== null,
        progress: modelDownload?.progress ?? (status.present ? 1 : 0),
        ...(modelDownload?.error ? { error: modelDownload.error } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /system/audio/model — start the download. Idempotent: asking twice
  // while one is running joins the existing download rather than starting a
  // second one over the same files.
  router.post('/audio/model', async (_req, res, next) => {
    try {
      if (modelDownload) {
        res.status(202).json({ downloading: true, progress: modelDownload.progress });
        return;
      }
      const status = await nemotronModelStatus();
      if (status.present) {
        res.json({ downloading: false, progress: 1, present: true });
        return;
      }
      const controller = new AbortController();
      const entry: ModelDownload = {
        progress: 0,
        controller,
        promise: Promise.resolve(),
      };
      entry.promise = downloadNemotronModel({
        logger: container.logger,
        signal: controller.signal,
        onProgress: (p) => {
          entry.progress = p.progress;
        },
      })
        .then(() => {
          container.logger.info('[SystemRoutes] Nemotron model download complete');
        })
        .catch((err: unknown) => {
          entry.error = err instanceof Error ? err.message : String(err);
          container.logger.warn(`[SystemRoutes] Nemotron model download failed: ${entry.error}`);
        })
        .finally(() => {
          // Keep a failed download visible for one more poll, then clear.
          setTimeout(() => {
            if (modelDownload === entry) modelDownload = null;
          }, 5_000).unref?.();
        });
      modelDownload = entry;
      res.status(202).json({ downloading: true, progress: 0, repo: NEMOTRON_REPO });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/audio/model', async (_req, res, next) => {
    try {
      modelDownload?.controller.abort();
      modelDownload = null;
      await deleteNemotronModel();
      res.json(await nemotronModelStatus());
    } catch (err) {
      next(err);
    }
  });

  // ── Workspace retention ────────────────────────────────────────
  //
  // The only scheduled job in the product that deletes the user's files, so
  // it is opt-in and reports exactly what it would act on.

  const workspaceRetentionSchema = z.object({
    enabled: z.boolean(),
    retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
  });

  // GET /system/workspace-retention
  router.get('/workspace-retention', (_req, res, next) => {
    try {
      res.json({ ...readWorkspaceRetentionPreferences(dataDir), minDays: MIN_RETENTION_DAYS, maxDays: MAX_RETENTION_DAYS });
    } catch (err) {
      next(err);
    }
  });

  // PUT /system/workspace-retention — applies to the next nightly sweep; the
  // service re-reads preferences every tick, so no restart is needed and
  // switching it off part-way through a night takes effect immediately.
  router.put('/workspace-retention', (req, res, next) => {
    const parsed = workspaceRetentionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    try {
      const current = readWorkspaceRetentionPreferences(dataDir);
      const saved = writeWorkspaceRetentionPreferences(dataDir, {
        enabled: parsed.data.enabled,
        retentionDays: parsed.data.retentionDays ?? current.retentionDays,
      });
      res.json({ ...saved, minDays: MIN_RETENTION_DAYS, maxDays: MAX_RETENTION_DAYS });
    } catch (err) {
      next(err);
    }
  });

  // POST /system/workspace-retention/run — sweep now, without waiting for
  // tonight. Deliberately works even when the nightly job is off: "clean up
  // now" is an explicit instruction, not a scheduled deletion.
  router.post('/workspace-retention/run', async (req, res, next) => {
    try {
      const service = container.workspaceRetentionService;
      if (!service) {
        res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Workspace retention is not wired on this server.' } });
        return;
      }
      const days = typeof req.body?.retentionDays === 'number'
        ? req.body.retentionDays
        : readWorkspaceRetentionPreferences(dataDir).retentionDays;
      res.json(await service.runOnce(days));
    } catch (err) {
      next(err);
    }
  });

  // GET /system/computer-use — is desktop automation available to agents?
  router.get('/computer-use', async (_req, res, next) => {
    try {
      res.json({
        enabled: container.computerService.isEnabled(),
        allowSynthetic: container.computerService.isSyntheticAllowed(),
        killSwitch: killSwitchEngaged(),
        skillId: COMPUTER_USE_SKILL_ID,
        // Workspace-independent: whether a driver exists at all. Session state
        // is per-workspace and lives on /workspaces/:id/computer/runtime.
        runtime: await container.computerService.runtimeStatus(),
      });
    } catch (err) {
      next(err);
    }
  });

  // PUT /system/computer-use — the Settings toggles. Applies live: the flags are
  // read when a chat's conversation config is built, and flipping `enabled`
  // changes the conversation binding key so open chats rebind on their next turn.
  router.put('/computer-use', async (req, res, next) => {
    const parsed = computerUseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    if (parsed.data.enabled && killSwitchEngaged()) {
      res.status(409).json({
        error: {
          code: 'KILL_SWITCH_ENGAGED',
          message: `Computer Use is disabled by ${COMPUTER_USE_KILL_SWITCH_ENV} in this server's environment.`,
        },
      });
      return;
    }
    const prefs = {
      enabled: parsed.data.enabled,
      allowSynthetic: parsed.data.allowSynthetic ?? container.computerService.isSyntheticAllowed(),
    };
    writeComputerUsePreferences(dataDir, prefs);
    container.computerService.setEnabled(prefs.enabled);
    container.computerService.setSyntheticAllowed(prefs.allowSynthetic);
    try {
      res.json({
        enabled: container.computerService.isEnabled(),
        allowSynthetic: container.computerService.isSyntheticAllowed(),
        killSwitch: false,
        skillId: COMPUTER_USE_SKILL_ID,
        runtime: await container.computerService.runtimeStatus(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
