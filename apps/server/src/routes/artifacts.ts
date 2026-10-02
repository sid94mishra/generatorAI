import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { Container } from '../composition-root.js';

/** Registered artifact bytes, constrained to managed storage and the owning session scope. */
export function createArtifactRoutes(container: Container): Router {
  const router = Router();
  router.get('/:id/download', async (req, res, next) => {
    try {
      const artifact = await container.artifactService.getArtifact(String(req.params['id']));
      if (!artifact) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }); return; }
      const session = await container.sessionRepo.getById(artifact.sessionId);
      const requiredScope = session.ownerType === 'workflow_run' || session.ownerType === 'stage_run' ? 'read:workflows' : 'read:chats';
      if (req.principal && !req.principal.scopes.includes(requiredScope)) {
        res.status(403).json({ error: { code: 'INSUFFICIENT_SCOPE', message: `Artifact requires ${requiredScope}` } }); return;
      }
      const root = await realpath(container.config.artifactsDir);
      const file = await realpath(artifact.path);
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        res.status(403).json({ error: { code: 'ARTIFACT_PATH_FORBIDDEN', message: 'Artifact is outside managed storage' } }); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(artifact.name))}`);
      res.sendFile(file, (error) => { if (error) next(error); });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Artifact file not found' } }); return; }
      next(error);
    }
  });
  return router;
}
