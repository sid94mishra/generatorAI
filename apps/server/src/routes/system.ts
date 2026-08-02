// ────────────────────────────────────────────────────────────────
// System Routes — System-level artifacts (skills, prompts, agents) + MCP
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Container } from '../composition-root.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Resolve templates/system relative to this file (apps/server/src/routes → root/templates/system)
const SYSTEM_TEMPLATES_DIR = join(__dirname, '../../../../templates/system');

export function createSystemRoutes(container: Container): Router {
  const router = Router();
  const { systemArtifactService } = container;

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

  return router;
}
