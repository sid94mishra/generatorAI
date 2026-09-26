// ────────────────────────────────────────────────────────────────
// Workflow Scripts Routes — list, profiles, materialize, reload, upload.
// Running a script is an invocation (`POST /workflow-invocations`,
// `target: {kind: 'script'}`), materialized once per script content.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type { WorkflowGraph } from '@generatorai/workflow-spec';
import { ScriptSecurityError } from '@generatorai/core';
import type { Response } from 'express';

/**
 * The loader refuses every load when workflow scripts are not opted in
 * (config `scripts.workflowScriptsEnabled`). Surface that as a 403 with a
 * stable code so the CLI / web can explain it, instead of a generic 500.
 */
function respondIfScriptsDisabled(err: unknown, res: Response): boolean {
  if (err instanceof ScriptSecurityError && /disabled/i.test(err.message)) {
    res.status(403).json({ error: { code: 'WORKFLOW_SCRIPTS_DISABLED', message: err.message } });
    return true;
  }
  return false;
}

export function createWorkflowScriptRoutes(container: Container): Router {
  const router = Router();
  const { workflowScriptLoader, workflowDefinitionService, logger } = container;

  // GET /workflow-scripts — List all discovered scripts with metadata
  router.get('/', (_req, res, next) => {
    try {
      const scripts = workflowScriptLoader.getAllMetadata();
      res.json(scripts);
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-scripts/:id — Get single script metadata + full output preview
  router.get('/:id', (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const script = workflowScriptLoader.getScript(id);
      if (!script) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Script not found: ${id}` } });
        return;
      }
      res.json({ metadata: script.metadata, graph: script.graph });
    } catch (err) {
      next(err);
    }
  });

  // GET /workflow-scripts/:id/profiles — Get profiles defined in script
  router.get('/:id/profiles', (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const script = workflowScriptLoader.getScript(id);
      if (!script) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Script not found: ${id}` } });
        return;
      }
      res.json(script.profiles);
    } catch (err) {
      next(err);
    }
  });

  /**
   * The script's graph as a new definition's document: tagged with the
   * script id, optionally renamed and bound to a project. Scripts are loaded
   * only when an operator opted in (and uploads need admin), so their
   * command-bearing fields are trusted like the operator's own.
   */
  function scriptGraph(id: string, graph: WorkflowGraph, opts: { name?: string; projectId?: string }): WorkflowGraph {
    return {
      ...graph,
      workflow: {
        ...graph.workflow,
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        tags: [...new Set([...graph.workflow.tags, `script:${id}`])].slice(0, 20),
      },
    };
  }

  // POST /workflow-scripts/:id/materialize — a draft definition from the script
  router.post('/:id/materialize', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const script = workflowScriptLoader.getScript(id);
      if (!script) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Script not found: ${id}` } });
        return;
      }
      const { name, projectId } = req.body as { name?: string; projectId?: string };
      // The one materializer (PD-16).
      const definition = await workflowDefinitionService.createFromSpec(
        scriptGraph(id, script.graph, { ...(name ? { name } : {}), ...(projectId ? { projectId } : {}) }),
        { canEditCommands: true, status: 'draft' },
      );
      logger.info(`[WorkflowScripts] Materialized script '${id}' into definition ${definition.id}`, {
        stages: script.graph.stages.length,
      });
      res.status(201).json({
        definitionId: definition.id,
        definition,
        stageCount: script.graph.stages.length,
        edgeCount: script.graph.edges.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-scripts/reload — Force re-scan and reload all scripts
  router.post('/reload', async (_req, res, next) => {
    try {
      const metadata = await workflowScriptLoader.reloadAll();
      logger.info(`[WorkflowScripts] Reloaded all scripts: ${metadata.length}`);
      res.json({ count: metadata.length, scripts: metadata, scriptsEnabled: workflowScriptLoader.isEnabled() });
    } catch (err) {
      if (respondIfScriptsDisabled(err, res)) return;
      next(err);
    }
  });

  // POST /workflow-scripts/:id/reload — Reload single script
  router.post('/:id/reload', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const loaded = await workflowScriptLoader.reloadScript(id);
      logger.info(`[WorkflowScripts] Reloaded script: ${id}`);
      res.json(loaded.metadata);
    } catch (err) {
      if (respondIfScriptsDisabled(err, res)) return;
      if (respondIfScriptsDisabled((err as Error).cause, res)) return;
      if ((err as Error).message?.includes('not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: (err as Error).message } });
        return;
      }
      next(err);
    }
  });

  // POST /workflow-scripts/upload — Upload a user-authored .workflow.mjs (SCRIPT-1)
  //
  // SECURITY: a workflow script executes arbitrary JavaScript in-process with
  // full server privileges (dynamic import). Accepting one over HTTP is
  // effectively a remote-code-execution surface, so this endpoint is DISABLED
  // by default and must be explicitly enabled by the operator via
  // GENERATORAI_ALLOW_SCRIPT_UPLOAD=true (mirrors the host-sandbox opt-in gate).
  // When disabled it returns 403 so the capability is discoverable but inert.
  //
  // Body: { filename: string (e.g. "my.workflow.mjs"), source: string }
  router.post('/upload', async (req, res, next) => {
    try {
      // Defense-in-depth only — the loader itself refuses when scripts are
      // not opted in (`WorkflowScriptLoader.assertEnabled`). Upload keeps its
      // own, stricter flag because it also WRITES into the templates dir.
      if (process.env['GENERATORAI_ALLOW_SCRIPT_UPLOAD'] !== 'true' || !workflowScriptLoader.isEnabled()) {
        res.status(403).json({
          error: {
            code: 'SCRIPT_UPLOAD_DISABLED',
            message:
              'Script upload is disabled. Scripts run with full server privileges; ' +
              'set GENERATORAI_ALLOW_SCRIPT_UPLOAD=true to enable (trusted/localhost only).',
          },
        });
        return;
      }
      const { filename, source } = (req.body ?? {}) as { filename?: unknown; source?: unknown };
      if (typeof filename !== 'string' || typeof source !== 'string' || source.length === 0) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'filename and non-empty source are required' },
        });
        return;
      }
      // Route-boundary filename guard (defense-in-depth; the loader re-validates):
      // reject any path segment and require the .workflow.mjs extension.
      if (/[\\/]|\.\./.test(filename) || !filename.endsWith('.workflow.mjs')) {
        res.status(400).json({
          error: {
            code: 'INVALID_SCRIPT',
            message: 'filename must be a bare name ending in .workflow.mjs (no path segments)',
          },
        });
        return;
      }
      const loaded = await workflowScriptLoader.saveScript(filename, source);
      logger.warn(`[WorkflowScripts] Uploaded and loaded script '${loaded.metadata.id}' (RCE surface — opt-in enabled)`);
      res.status(201).json(loaded.metadata);
    } catch (err) {
      if (respondIfScriptsDisabled(err, res)) return;
      const msg = (err as Error).message ?? '';
      if (/Invalid script filename|must end with|not within allowed/i.test(msg)) {
        res.status(400).json({ error: { code: 'INVALID_SCRIPT', message: msg } });
        return;
      }
      next(err);
    }
  });

  // POST /workflow-scripts/validate — Validate script at given path
  router.post('/validate', async (req, res, next) => {
    try {
      const { path } = req.body as { path: string };
      if (!path) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path is required' } });
        return;
      }
      const result = await workflowScriptLoader.validateScriptFile(path);
      res.json(result);
    } catch (err) {
      if (respondIfScriptsDisabled(err, res)) return;
      next(err);
    }
  });

  return router;
}
