// ────────────────────────────────────────────────────────────────
// Attention feed — GET /api/attention (G-01).
//
// The Needs you + Running snapshot `AttentionService` holds in memory. Live
// deltas follow on the `global` stream scope (`attention.*`); a client folds
// them in by `seq` and refetches this on a gap.
//
// Read scope is `read:activity` (`routePolicy.ts`), the same scope that opens
// the lifecycle-only `global` feed. `ask.detail` and `progress.label` can
// carry commands and file names, so they are stripped for a principal that
// lacks `read:chats` (chat items) or `read:workflows` (run and automation
// items) — the same rule the stream applies to `attention.upsert`.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { redactAttentionSnapshot } from '@generatorai/core';
import type { Container } from '../composition-root.js';

export function createAttentionRoutes(container: Container): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const raw = req.query['projectId'];
    if (raw !== undefined && (typeof raw !== 'string' || raw.length === 0 || raw.length > 200)) {
      res.status(400).json({
        error: { code: 'INVALID_PROJECT_ID', message: '`projectId` must be a non-empty string' },
      });
      return;
    }
    // A feed that never started (or failed to) is unknown, not empty (D-36).
    if (!container.attentionService.isAvailable()) {
      res.status(503).set('Cache-Control', 'no-store').json({
        error: { code: 'ATTENTION_UNAVAILABLE', message: 'The attention feed is not available on this server' },
      });
      return;
    }
    const snapshot = container.attentionService.getSnapshot(raw ? { projectId: raw } : {});
    // No principal means unauthenticated loopback development mode, which
    // reads everything (see `canBypassPermissions` in chats.ts).
    const scopes = req.principal ? req.principal.scopes : null;
    res.set('Cache-Control', 'no-store').json(redactAttentionSnapshot(snapshot, scopes));
  });

  return router;
}
