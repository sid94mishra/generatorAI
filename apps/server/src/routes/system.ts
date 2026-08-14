// ────────────────────────────────────────────────────────────────
// System Routes — System-level artifacts (skills, prompts, agents) + MCP
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  COMPUTER_USE_DISABLE_TOKENS,
  COMPUTER_USE_KILL_SWITCH_ENV,
  COMPUTER_USE_SKILL_ID,
} from '@generatorai/shared';
import type { Container } from '../composition-root.js';
import { readComputerUsePreferences, writeComputerUsePreferences } from '../settings/computerUse.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Resolve templates/system relative to this file (apps/server/src/routes → root/templates/system)
const SYSTEM_TEMPLATES_DIR = join(__dirname, '../../../../templates/system');

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
  const { systemArtifactService } = container;
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

  // GET /system/mcp-servers — List built-in system MCP servers
  router.get('/mcp-servers', async (req, res, next) => {
    try {
      const filePath = join(SYSTEM_TEMPLATES_DIR, 'mcp-servers.json');
      const raw = await readFile(filePath, 'utf-8');
      res.json(JSON.parse(raw));
    } catch {
      res.json([]);
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
