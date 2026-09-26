// ────────────────────────────────────────────────────────────────
// Settings routes read by authoring surfaces.
//
//   GET /settings/script-allowlist — the commands a `check` stage (and any
//   script hook) may run: the defaults plus the operator's extras
//   (`scripts.extraAllowlist`). The builder's command picker reads it; the
//   server validates checks against the same list (P05 §1.2).
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { DEFAULT_COMMAND_ALLOWLIST } from '@generatorai/workflow-spec';
import type { Container } from '../composition-root.js';

export function createSettingsRoutes(container: Container): Router {
  const router = Router();

  router.get('/script-allowlist', (_req, res) => {
    const commands = container.scriptRunner.getAllowlist();
    const defaults = new Set(DEFAULT_COMMAND_ALLOWLIST);
    res.json({
      commands,
      defaults: [...DEFAULT_COMMAND_ALLOWLIST].sort(),
      extras: commands.filter((c) => !defaults.has(c)),
    });
  });

  return router;
}
