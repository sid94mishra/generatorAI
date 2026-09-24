// ────────────────────────────────────────────────────────────────
// Workflow Scripts Routes — CRUD + materialize + run
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import type { Container } from '../composition-root.js';
import type { StageEdgeType } from '@generatorai/shared';
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

type CanonicalPermissionMode = 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan';

/**
 * SCHEMA-1: Map the script-profile permission-mode vocabulary
 * (`askOnEachTool | askOnce | bypassPermissions`) onto the canonical run
 * permission-mode vocabulary (`bypassPermissions | default | acceptEdits |
 * plan`). The two enums diverged; persisting a raw script value left invalid
 * data on the run. Already-canonical values pass through unchanged.
 */
function mapScriptPermissionMode(mode: string | undefined): CanonicalPermissionMode | undefined {
  if (!mode) return undefined;
  switch (mode) {
    case 'askOnEachTool':
      return 'default'; // prompt on each tool use === default HITL behaviour
    case 'askOnce':
      return 'acceptEdits'; // ask once, then auto-accept edits
    case 'bypassPermissions':
    case 'default':
    case 'acceptEdits':
    case 'plan':
      return mode;
    default:
      return undefined; // unknown — drop rather than persist garbage
  }
}

export function createWorkflowScriptRoutes(container: Container): Router {
  const router = Router();
  const { workflowScriptLoader, workflowDefinitionService, workflowRunService, logger } = container;

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
      res.json({
        metadata: script.metadata,
        definition: script.output.definition,
        stages: script.output.stages.map((s: { localId: string; config: unknown }) => ({ localId: s.localId, config: s.config })),
        edges: script.output.edges,
      });
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

  // POST /workflow-scripts/:id/materialize — Create WorkflowDefinition from script
  router.post('/:id/materialize', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const script = workflowScriptLoader.getScript(id);
      if (!script) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Script not found: ${id}` } });
        return;
      }

      const { name, projectId, variables } = req.body as {
        name?: string;
        projectId?: string;
        variables?: Record<string, unknown>;
      };

      // Create the workflow definition from script output
      const defParams = {
        name: name ?? script.output.definition.name,
        description: script.output.definition.description,
        sessionMode: script.output.definition.sessionMode,
        harnessConfig: script.output.definition.harnessConfig,
        variables: script.output.definition.variables,
        tags: [...script.output.definition.tags, `script:${id}`],
        projectId,
        skills: script.output.definition.skills,
        agents: script.output.definition.agents,
        hooks: script.output.definition.hooks,
      };

      const definition = await workflowDefinitionService.createDefinition(defParams);

      // Add stages
      const stageIdMap = new Map<string, string>(); // localId → actual UUID
      for (const stage of script.output.stages) {
        const stageResult = await workflowDefinitionService.addStage({
          workflowDefinitionId: definition.id,
          name: stage.config.name,
          description: stage.config.description,
          order: stage.config.order,
          prompts: stage.config.prompts,
          hooks: stage.config.hooks,
          variables: stage.config.variables
            ? { ...stage.config.variables, ...(variables ?? {}) }
            : variables,
          harnessConfigOverrides: stage.config.harnessConfigOverrides,
          agentRef: stage.config.agentRef,
          contextFilter: stage.config.contextFilter,
          // SCRIPT-2: forward contextSources (.contextFrom([...]) in scripts) —
          // previously dropped here, so a script's explicit context wiring was
          // silently lost on materialize/run (importFromJSON already kept it).
          contextSources: stage.config.contextSources,
          outputFormat: stage.config.outputFormat,
          retryPolicy: stage.config.retryPolicy,
          timeoutMs: stage.config.timeoutMs,
          condition: stage.config.condition,
          iterationConfig: stage.config.iterationConfig,
          skills: stage.config.skills,
          approvalRequired: stage.config.approvalRequired,
        });
        stageIdMap.set(stage.localId, stageResult.id);
      }

      // Add edges (resolve localId → actual IDs)
      for (const edge of script.output.edges) {
        const fromId = stageIdMap.get(edge.from);
        const toId = stageIdMap.get(edge.to);
        if (fromId && toId) {
          await workflowDefinitionService.addEdge({
            workflowDefinitionId: definition.id,
            fromStageId: fromId,
            toStageId: toId,
            edgeType: edge.edgeType as StageEdgeType,
          });
        }
      }

      logger.info(
        `[WorkflowScripts] Materialized script '${id}' into definition ${definition.id}`,
        { stages: stageIdMap.size },
      );

      res.status(201).json({
        definitionId: definition.id,
        definition,
        stageCount: stageIdMap.size,
        edgeCount: script.output.edges.length,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /workflow-scripts/:id/run — Materialize + create run + start
  router.post('/:id/run', async (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const script = workflowScriptLoader.getScript(id);
      if (!script) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `Script not found: ${id}` } });
        return;
      }

      const { profileName, variables, projectId } = req.body as {
        profileName?: string;
        variables?: Record<string, unknown>;
        projectId?: string;
      };

      // Resolve profile if specified
      let resolvedVars = variables ?? {};
      let resolvedSessionMode = script.output.definition.sessionMode;
      let resolvedStageOverrides: unknown[] | undefined;
      let resolvedPermissionMode: string | undefined;

      if (profileName) {
        const profile = script.profiles.find((p: { name: string }) => p.name === profileName);
        if (!profile) {
          res.status(400).json({
            error: { code: 'INVALID_PROFILE', message: `Profile not found: ${profileName}` },
          });
          return;
        }
        resolvedVars = { ...profile.variables, ...resolvedVars };
        resolvedSessionMode = profile.sessionMode ?? resolvedSessionMode;
        // PWS-08 — propagate stageOverrides and permissionMode from the
        // profile into the run. Previously these were silently dropped, so
        // profile `skip: true` and timeout overrides had no effect.
        // Stage overrides ride in the run's variables under the well-known
        // `__stageOverrides` key (consumed by WorkflowRunService.findStageOverride).
        // Runtime overrides take precedence; explicit ones in the request body
        // are merged on top of the profile's.
        const profileOverrides = (profile as { stageOverrides?: unknown[] }).stageOverrides;
        const runtimeOverrides = (variables?.['__stageOverrides'] as unknown[] | undefined);
        if (profileOverrides || runtimeOverrides) {
          resolvedStageOverrides = [
            ...(profileOverrides ?? []),
            ...(runtimeOverrides ?? []),
          ];
        }
        resolvedPermissionMode = (profile as { permissionMode?: string }).permissionMode;
      }

      // Stage overrides — fold into variables so the runner picks them up.
      if (resolvedStageOverrides && resolvedStageOverrides.length > 0) {
        resolvedVars = { ...resolvedVars, __stageOverrides: resolvedStageOverrides };
      }

      // Materialize first
      const defParams = {
        name: script.output.definition.name,
        description: script.output.definition.description,
        sessionMode: resolvedSessionMode,
        harnessConfig: script.output.definition.harnessConfig,
        variables: script.output.definition.variables,
        tags: [...script.output.definition.tags, `script:${id}`],
        projectId,
        skills: script.output.definition.skills,
        agents: script.output.definition.agents,
        hooks: script.output.definition.hooks,
      };

      const definition = await workflowDefinitionService.createDefinition(defParams);

      // Add stages
      const stageIdMap = new Map<string, string>();
      for (const stage of script.output.stages) {
        const stageResult = await workflowDefinitionService.addStage({
          workflowDefinitionId: definition.id,
          name: stage.config.name,
          description: stage.config.description,
          order: stage.config.order,
          prompts: stage.config.prompts,
          hooks: stage.config.hooks,
          variables: stage.config.variables
            ? { ...stage.config.variables, ...(resolvedVars) }
            : resolvedVars,
          harnessConfigOverrides: stage.config.harnessConfigOverrides,
          agentRef: stage.config.agentRef,
          contextFilter: stage.config.contextFilter,
          // SCRIPT-2: forward contextSources (.contextFrom([...]) in scripts) —
          // previously dropped here, so a script's explicit context wiring was
          // silently lost on materialize/run (importFromJSON already kept it).
          contextSources: stage.config.contextSources,
          outputFormat: stage.config.outputFormat,
          retryPolicy: stage.config.retryPolicy,
          timeoutMs: stage.config.timeoutMs,
          condition: stage.config.condition,
          iterationConfig: stage.config.iterationConfig,
          skills: stage.config.skills,
          approvalRequired: stage.config.approvalRequired,
        });
        stageIdMap.set(stage.localId, stageResult.id);
      }

      // Add edges
      for (const edge of script.output.edges) {
        const fromId = stageIdMap.get(edge.from);
        const toId = stageIdMap.get(edge.to);
        if (fromId && toId) {
          await workflowDefinitionService.addEdge({
            workflowDefinitionId: definition.id,
            fromStageId: fromId,
            toStageId: toId,
            edgeType: edge.edgeType as StageEdgeType,
          });
        }
      }

      // Create and start the run
      const run = await workflowRunService.createRun({
        workflowDefinitionId: definition.id,
        variables: resolvedVars,
        projectId,
      });

      // Apply profile permissionMode if provided.
      // SCHEMA-1: the script-profile vocabulary (askOnEachTool | askOnce |
      // bypassPermissions) is NOT the canonical run permission-mode vocabulary
      // (bypassPermissions | default | acceptEdits | plan). Map it before
      // persisting, otherwise an invalid value (e.g. 'askOnce') is stored and
      // every downstream consumer of the canonical enum chokes on it.
      const canonicalPermissionMode = mapScriptPermissionMode(resolvedPermissionMode);
      if (canonicalPermissionMode) {
        try {
          await workflowRunService.setPermissionMode(run.id, canonicalPermissionMode);
        } catch (err) {
          logger.warn(
            `[WorkflowScripts] Failed to set permissionMode '${canonicalPermissionMode}' (from profile '${resolvedPermissionMode}') on run ${run.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Start the run
      await workflowRunService.startRun(run.id);

      logger.info(
        `[WorkflowScripts] Created and started run from script '${id}': ${run.id}`,
      );

      res.status(202).json({
        definitionId: definition.id,
        runId: run.id,
        status: 'running',
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
