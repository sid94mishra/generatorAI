// ────────────────────────────────────────────────────────────────
// WorkflowOrchestrator — High-level orchestrator that manages
// the complete lifecycle of a workflow execution:
//   1. Input validation and variable resolution
//   2. Git repository cloning (single or multiple codebases)
//   3. Preprocessing steps (scripts, conditions, setup)
//   4. DAG-based stage execution (via WorkflowRunService)
//   5. Per-stage result validation
//   6. Post-processing and cleanup
//
// Supports system workflows (predefined, locked core logic),
// custom workflows, and derived workflows built on system templates.
// ────────────────────────────────────────────────────────────────

import type {
  OrchestratedRunParams,
  OrchestratorContext,
  OrchestratorConfig,
  PreprocessingResult,
  PostProcessingStep,
  WorkflowRun,
  WorkflowDefinition,
  GitRepositoryConfig,
  ILogger,
  CreateWorkflowDefinitionParams,
  WorkflowTemplate,
  HookDefinition,
  WorkflowHookDefinition,
  HookPhaseResult,
} from '@generatorai/shared';
import { generateId, ValidationError } from '@generatorai/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkflowRunService } from './WorkflowRunService.js';
import type { WorkflowDefinitionService } from './WorkflowDefinitionService.js';
import { repositoryFromInputs, type WorkflowPreprocessor } from './WorkflowPreprocessor.js';
import type { IWorkflowRunRepository } from '../domain/ports/IWorkflowRunRepository.js';
import type { EventBus } from '../events/EventBus.js';
import type { SandboxLifecycleManager, SandboxSession } from './SandboxLifecycleManager.js';
import type { ISandboxProvider } from '../domain/ports/ISandboxProvider.js';
import { SandboxScriptRunner } from '../infrastructure/SandboxScriptRunner.js';
import type { WorktreeService } from './WorktreeService.js';
import type { ProjectService } from './ProjectService.js';
import type { ProjectConfigService } from './ProjectConfigService.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import type { TemplateRegistry } from './TemplateRegistry.js';
import type { HookExecutor, HookContext } from './HookExecutor.js';

/**
 * Item 10 — shape persisted under `run.variables.__postProcessingIntent`.
 * Just enough to rebuild a minimal `OrchestratorContext` and re-run
 * `setupCompletionCleanup` after a restart; see `reArmPendingPostProcessing`.
 */
interface PersistedPostProcessingIntent {
  pending: boolean;
  runWorkspaceDir: string;
  gitRepositories: GitRepositoryConfig[];
  clonedRepositories: Record<string, string>;
  featureBranches: Record<string, string>;
}

export class WorkflowOrchestrator {
  constructor(
    private readonly workflowRunService: WorkflowRunService,
    private readonly definitionService: WorkflowDefinitionService,
    private readonly preprocessor: WorkflowPreprocessor,
    private readonly runRepo: IWorkflowRunRepository,
    private readonly eventBus: EventBus,
    private readonly templateRegistry: TemplateRegistry,
    private readonly logger: ILogger,
    private readonly artifactsDir?: string,
    private readonly sandboxLifecycleManager?: SandboxLifecycleManager,
    private readonly sandboxProvider?: ISandboxProvider,
    private readonly worktreeService?: WorktreeService,
    private readonly projectService?: ProjectService,
    private readonly projectConfigService?: ProjectConfigService,
    private readonly workspaceManager?: WorkspaceManager,
    private readonly hookExecutor?: HookExecutor,
  ) {}

  /**
   * Build a HookContext from the current orchestration state.
   * Uses '__orchestrator__' as sessionId since workflow-level hooks
   * don't belong to any specific SDK session.
   */
  private buildWorkflowHookContext(
    runId: string,
    definitionId: string,
    context: OrchestratorContext,
  ): HookContext {
    return {
      sessionId: `__orchestrator_${runId}__`,
      workflowId: definitionId,
      workspacePath: (context.resolvedVariables['__workingDirectory'] as string) ?? '',
      variables: context.resolvedVariables as Record<string, string>,
      eventBus: this.eventBus,
      // Stamp the run id so orchestrator hook lifecycle events surface in scope='run'.
      workflowRunId: runId,
    };
  }

  /**
   * Execute workflow-level hooks for a given phase.
   * Non-fatal: errors are logged but do not abort orchestration
   * (unless the hook's failurePolicy is 'abort').
   */
  private async executeWorkflowHooks(
    phase: WorkflowHookDefinition['phase'],
    hooks: WorkflowHookDefinition[] | undefined,
    hookCtx: HookContext,
  ): Promise<HookPhaseResult> {
    if (!this.hookExecutor || !hooks || hooks.length === 0) return { shouldContinue: true, mergedResult: {} };
    try {
      return await this.hookExecutor.executePhase(
        phase,
        hooks as unknown as HookDefinition[],
        hookCtx,
      );
    } catch (err) {
      this.logger.warn(`[Orchestrator] Workflow hook phase '${phase}' error (non-fatal): ${err}`);
      return { shouldContinue: true, mergedResult: {} };
    }
  }

  /**
   * Get the per-run uploads directory.
   * When WorkspaceManager is available, uses `{workspace}/config/`.
   * Otherwise falls back to the legacy `{artifactsDir}/runs/{runId}/uploads/` path.
   */
  async getRunUploadsDir(runId: string): Promise<string> {
    if (this.workspaceManager) {
      const workspace = await this.workspaceManager.findWorkspaceByOwner(runId);
      if (workspace) {
        const uploadsPath = path.join(workspace.rootPath, 'config');
        await fs.mkdir(uploadsPath, { recursive: true });
        return uploadsPath;
      }
    }
    const baseDir = this.artifactsDir ?? path.join(process.cwd(), '.generatorai', 'artifacts');
    const uploadsPath = path.join(baseDir, 'runs', runId, 'uploads');
    await fs.mkdir(uploadsPath, { recursive: true });
    return uploadsPath;
  }

  /**
   * Get the workflow-level uploads directory shared across all runs.
   * Structure: {artifactsDir}/workflows/{definitionId}/uploads/
   * NOTE: Workflow-level uploads are definition-scoped (not per-run),
   * so they remain under the artifacts dir.
   */
  async getWorkflowUploadsDir(definitionId: string): Promise<string> {
    const baseDir = this.artifactsDir ?? path.join(process.cwd(), '.generatorai', 'artifacts');
    const uploadsPath = path.join(baseDir, 'workflows', definitionId, 'uploads');
    await fs.mkdir(uploadsPath, { recursive: true });
    return uploadsPath;
  }

  /**
   * Get workspace info (directories) for a run.
   * Delegates to WorkspaceManager when available; legacy fallback otherwise.
   */
  async getRunWorkspaceDirs(runId: string): Promise<{
    workspaceDir: string;
    artifactsDir: string;
    uploadsDir: string;
  }> {
    if (this.workspaceManager) {
      const workspace = await this.workspaceManager.findWorkspaceByOwner(runId);
      if (workspace) {
        return {
          workspaceDir: workspace.rootPath,
          artifactsDir: path.join(workspace.rootPath, 'artifacts'),
          uploadsDir: path.join(workspace.rootPath, 'config'),
        };
      }
    }
    // Legacy fallback
    const baseDir = this.artifactsDir ?? path.join(process.cwd(), '.generatorai', 'artifacts');
    return {
      workspaceDir: path.join(baseDir, 'runs', runId, 'workspace'),
      artifactsDir: path.join(baseDir, 'runs', runId, 'artifacts'),
      uploadsDir: path.join(baseDir, 'runs', runId, 'uploads'),
    };
  }

  /**
   * Link workflow-level uploads into a run's uploads directory (Phase 2, 2.5).
   * Preserves category structure (skills/, agents/, prompts/).
   *
   * Tries hardlink → symlink → copy in that order:
   *   - `fs.link` is instant, zero extra disk, same filesystem only.
   *   - `fs.symlink` works across mounts but needs privilege on Windows.
   *   - `fs.copyFile` is the last-resort fallback.
   *
   * The old implementation unconditionally copied, which duplicated a
   * 100 MB model upload across every run for that workflow.
   */
  async copyWorkflowUploadsToRun(definitionId: string, runId: string): Promise<void> {
    const workflowUploadsDir = await this.getWorkflowUploadsDir(definitionId);
    const runUploadsDir = await this.getRunUploadsDir(runId);

    for (const category of ['skills', 'agents', 'prompts']) {
      const srcDir = path.join(workflowUploadsDir, category);
      try {
        const files = await fs.readdir(srcDir);
        if (files.length === 0) continue;
        const destDir = path.join(runUploadsDir, category);
        await fs.mkdir(destDir, { recursive: true });
        for (const file of files) {
          const srcPath = path.join(srcDir, file);
          const destPath = path.join(destDir, file);
          // Don't overwrite run-level uploads that were uploaded separately
          try {
            await fs.access(destPath);
            continue;
          } catch {
            // not there — proceed to link
          }
          try {
            await fs.link(srcPath, destPath);
          } catch {
            try {
              // Symlink second: works cross-mount but may need privilege on Windows.
              // Use a relative target so moving the artifacts tree doesn't break.
              const relTarget = path.relative(path.dirname(destPath), srcPath);
              await fs.symlink(relTarget, destPath);
            } catch {
              // Last resort: copy. This is the slow path; only triggered
              // when neither hardlink nor symlink is permitted.
              await fs.copyFile(srcPath, destPath);
            }
          }
        }
        this.logger.info(
          `[Orchestrator] Linked ${files.length} ${category} file(s) from workflow to run ${runId}`,
        );
      } catch {
        // Category directory doesn't exist at workflow level — skip
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Template Management
  // ════════════════════════════════════════════════════════════════

  /** Get all available workflow templates */
  getWorkflowTemplates(): WorkflowTemplate[] {
    return this.templateRegistry.getAllWorkflowTemplates();
  }

  /** Get a specific workflow template */
  getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
    return this.templateRegistry.getWorkflowTemplate(id);
  }

  /**
   * Create a workflow definition from a template.
   * Locked stages are preserved, but user can configure variables.
   */
  async createFromTemplate(
    templateId: string,
    params: {
      name?: string;
      variables?: Record<string, unknown>;
      projectId?: string;
    },
  ): Promise<WorkflowDefinition> {
    // One importer. This used to be a second copy of
    // `WorkflowDefinitionService.importFromTemplate` that was not
    // transactional, hardcoded `sessionMode: 'auto'` and `autoCommit: true`,
    // and dropped the `imported` tag — see the note on the service method.
    // Auto-commit stays on for orchestrated (Settings → Templates) imports,
    // which is what that path always did.
    return this.definitionService.importFromTemplate(templateId, {
      name: params.name,
      projectId: params.projectId,
      variableOverrides: params.variables,
      autoCommit: true,
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Orchestrated Execution
  // ════════════════════════════════════════════════════════════════

  /**
   * Start an orchestrated workflow run.
   * This is the main entry point that handles the full lifecycle:
   *  1. Validate inputs
   *  2. Clone git repositories
   *  3. Run preprocessing steps
   *  4. Execute the DAG (via WorkflowRunService)
   *  5. Validate results
   *  6. Cleanup
   */
  async startOrchestratedRun(
    params: OrchestratedRunParams,
    initializeUploads?: (runId: string) => Promise<void>,
  ): Promise<OrchestratorContext> {
    const definition = await this.definitionService.getDefinition(params.workflowDefinitionId);
    const orchestratorConfig = definition.orchestratorConfig;

    // Merge git repos from definition config (legacy backward compat)
    const gitRepos = orchestratorConfig?.gitRepositories ?? [];

    // Validate required codebases
    // A repository URL typed into the run form counts: the template's clone
    // step clones it (see `repositoryFromInputs`).
    if (
      orchestratorConfig?.requiresCodebase &&
      gitRepos.length === 0 &&
      !params.projectId &&
      !repositoryFromInputs('target', params.variables ?? {})
    ) {
      throw new ValidationError(
        'This workflow requires at least one codebase. Please provide a git repository URL or link to a project.',
      );
    }

    // Validate required variables
    this.validateRequiredVariables(definition, params.variables ?? {});

    // Create workflow run (with optional projectId)
    const run = await this.workflowRunService.createRun({
      workflowDefinitionId: params.workflowDefinitionId,
      variables: params.variables,
      // Tags the run with `__projectId`, which is how clients find a
      // project's runs; without it a run started for a project was listed
      // under no project at all.
      ...(params.projectId ? { projectId: params.projectId } : {}),
    });

    // If projectId provided, store it on the run
    if (params.projectId) {
      await this.runRepo.update(run.id, { projectId: params.projectId } as Partial<WorkflowRun>);
    }

    // Initialize context
    const context: OrchestratorContext = {
      workflowRunId: run.id,
      workflowDefinitionId: params.workflowDefinitionId,
      clonedRepositories: {},
      featureBranches: {},
      // Saved back over the run's variables below, so it has to carry the
      // project tag `createRun` added, or the run loses it again.
      resolvedVariables: { ...params.variables, ...(params.projectId ? { __projectId: params.projectId } : {}) },
      preprocessingResults: [],
      postProcessingResults: [],
    };

    // Store stage overrides in resolved variables so they flow through to stage execution
    if (params.stageOverrides && params.stageOverrides.length > 0) {
      context.resolvedVariables['__stageOverrides'] = params.stageOverrides;
    }

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.orchestration_started',
      data: {
        workflowRunId: run.id,
        hasCodebases: gitRepos.length > 0 || (params.selectedCodebases?.length ?? 0) > 0,
        hasPreprocessing: (orchestratorConfig?.preprocessingSteps?.length ?? 0) > 0,
      },
    });

    // Execute orchestration asynchronously
    const effectiveProjectId = params.projectId ?? definition.projectId;
    this.executeOrchestration(run, definition, gitRepos, context, effectiveProjectId, params.selectedCodebases, initializeUploads)
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`[Orchestrator] Run ${run.id} failed: ${errorMsg}`);
      });

    return context;
  }

  /**
   * Cancel an orchestrated run — cleanup resources.
   */
  async cancelOrchestratedRun(runId: string): Promise<void> {
    // The clones to clean up come from the persisted intent, so a cancel
    // after a restart cleans up the same paths a live one would.
    const run = await this.runRepo.getById(runId).catch(() => undefined);
    const intent = (run?.variables as Record<string, unknown> | undefined)?.[
      '__postProcessingIntent'
    ] as PersistedPostProcessingIntent | undefined;
    const clonedRepositories = intent?.clonedRepositories ?? {};

    try {
      // Cancel the workflow run
      await this.workflowRunService.cancelRun(runId);
    } finally {
      // Always cleanup sandbox if active
      if (this.sandboxLifecycleManager) {
        try {
          await this.sandboxLifecycleManager.destroyForRun(runId);
          this.logger.info(`[Orchestrator] Sandbox destroyed during cancel for run ${runId}`);
        } catch (sandboxErr) {
          this.logger.warn(`[Orchestrator] Sandbox cleanup error during cancel for run ${runId}: ${sandboxErr}`);
        }
      }

      // Always cleanup cloned repos even if cancel throws
      if (Object.keys(clonedRepositories).length > 0) {
        try {
          await this.preprocessor.cleanup(clonedRepositories);
        } catch (cleanupErr) {
          this.logger.warn(`[Orchestrator] Cleanup error during cancel for run ${runId}: ${cleanupErr}`);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Private — Orchestration Pipeline
  // ════════════════════════════════════════════════════════════════

  private async executeOrchestration(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    gitRepos: GitRepositoryConfig[],
    context: OrchestratorContext,
    projectId?: string,
    selectedCodebases?: string[],
    initializeUploads?: (runId: string) => Promise<void>,
  ): Promise<void> {
    const orchestratorConfig = definition.orchestratorConfig;

    try {
      // ── Phase 0: Set up per-run workspace directory ──
      let runWorkspaceDir: string;
      let runArtifactsDir: string;
      let workspaceRootPath: string | undefined;
      if (this.workspaceManager) {
        // Use unified WorkspaceManager
        const workspace = await this.workspaceManager.createWorkspace({
          ownerType: 'workflow_run',
          ownerId: run.id,
          projectId,
          useWorktree: true,
          gitEnabled: true,
          stageSystemArtifacts: true,
          stageProjectArtifacts: !!projectId,
        });
        workspaceRootPath = workspace.rootPath;
        runWorkspaceDir = this.workspaceManager.getWorkingDirectory(workspace);
        runArtifactsDir = path.join(workspace.rootPath, 'artifacts');
        // Store workspaceId on the run
        await this.runRepo.update(run.id, { workspaceId: workspace.id } as Partial<WorkflowRun>);
      } else {
        // Legacy fallback — only used when WorkspaceManager is not available
        const baseDir = this.artifactsDir ?? path.join(process.cwd(), '.generatorai', 'artifacts');
        runWorkspaceDir = path.join(baseDir, 'runs', run.id, 'workspace');
        runArtifactsDir = path.join(baseDir, 'runs', run.id, 'artifacts');
        await fs.mkdir(runWorkspaceDir, { recursive: true });
        await fs.mkdir(runArtifactsDir, { recursive: true });
      }
      this.setSystemVariable(context, '__workingDirectory', runWorkspaceDir);
      this.setSystemVariable(context, '__workflowRunId', run.id);
      this.setSystemVariable(context, '__artifactsDirectory', runArtifactsDir);
      this.logger.info(`[Orchestrator] Created per-run workspace: ${runWorkspaceDir}`);

      // Run-specific files must arrive in the final workspace before hooks,
      // project defaults, or skill discovery can consume them.
      await initializeUploads?.(run.id);

      // ── Workflow Hook: on_run_start ──
      const hookCtx = this.buildWorkflowHookContext(run.id, definition.id, context);
      const startHookResult = await this.executeWorkflowHooks('on_run_start', definition.hooks, hookCtx);
      if (!startHookResult.shouldContinue) {
        throw new Error(startHookResult.mergedResult.abortReason ?? 'Workflow aborted by on_run_start hook');
      }
      // Merge hook-returned variables into orchestrator context
      if (startHookResult.mergedResult.variables) {
        for (const [k, v] of Object.entries(startHookResult.mergedResult.variables)) {
          context.resolvedVariables[k] = v;
        }
      }

      // ── Phase 1: Clone git repositories ──
      // ── Phase 1: Set up git repositories ──
      // If projectId is set, use worktrees from project codebases
      // Otherwise, fall back to legacy clone behavior
      // Resolve selectedCodebases: if empty but projectId exists, fall back to all ready project codebases

      // ── Workflow Hook: pre_clone ──
      await this.executeWorkflowHooks('pre_clone', definition.hooks, hookCtx);

      let resolvedCodebases = selectedCodebases;
      if (projectId && (!resolvedCodebases || resolvedCodebases.length === 0) && this.projectService && this.worktreeService) {
        try {
          const projectWithCbs = await this.projectService.getProjectWithCodebases(projectId);
          resolvedCodebases = projectWithCbs.codebases
            .filter(cb => cb.status === 'ready')
            .map(cb => cb.alias);
        } catch (err) {
          this.logger.warn(`[Orchestrator] Could not resolve project codebases for fallback: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (projectId && resolvedCodebases?.length && this.worktreeService) {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.worktree_creating',
          data: {
            workflowRunId: run.id,
            codebaseCount: resolvedCodebases.length,
            codebases: resolvedCodebases.map((alias) => ({ alias, codebaseId: alias })),
          },
        });

        const worktreeInfos = await this.worktreeService.createRunWorktrees(
          projectId,
          run.id,
          resolvedCodebases,
          'workflow',
          // Place worktrees in workspace source/ dir when WorkspaceManager is available
          workspaceRootPath ? path.join(workspaceRootPath, 'source') : undefined,
        );

        // The codebase's own default branch is the base a PR targets and the
        // branch the flow syncs before pushing. Best effort — a repository
        // hiccup must not fail the run, and the flow falls back to the
        // repo's `origin/HEAD` when this map has no entry for an alias.
        const defaultBranchByCodebase = new Map<string, string>();
        try {
          const withCodebases = await this.projectService?.getProjectWithCodebases(projectId);
          for (const cb of withCodebases?.codebases ?? []) {
            if (cb.defaultBranch) defaultBranchByCodebase.set(cb.id, cb.defaultBranch);
          }
        } catch (err) {
          this.logger.warn(`[Orchestrator] Could not resolve codebase default branches: ${err}`);
        }

        // Populate context from worktrees
        context.baseBranches ??= {};
        for (const wt of worktreeInfos) {
          const alias = path.basename(wt.worktreePath);
          context.clonedRepositories[alias] = wt.worktreePath;
          context.featureBranches[alias] = wt.branchName;
          context.resolvedVariables[`repo_path_${alias}`] = wt.worktreePath;
          context.resolvedVariables[`repo_branch_${alias}`] = wt.branchName;
          const base = defaultBranchByCodebase.get(wt.codebaseId);
          if (base) context.baseBranches[alias] = base;
        }

        // Set __workingDirectory to the first worktree path so
        // the Copilot SDK operates within the codebase.
        // Use direct assignment — setSystemVariable won't overwrite Phase 0's default.
        if (worktreeInfos.length > 0) {
          const primaryWorktree = worktreeInfos[0]!;
          context.resolvedVariables['__workingDirectory'] = primaryWorktree.worktreePath;
          this.logger.info(`[Orchestrator] Set workingDirectory to first worktree: ${primaryWorktree.worktreePath}`);

          // Backward-compat: system templates reference {{repo_path_target}}
          // (the legacy clone alias). Always set it to the primary worktree path
          // so templates that use "target" as the alias still resolve correctly.
          if (!context.resolvedVariables['repo_path_target']) {
            context.resolvedVariables['repo_path_target'] = primaryWorktree.worktreePath;
          }
        }

        this.logger.info(`[Orchestrator] Created ${worktreeInfos.length} worktrees for project run`);
      } else if (gitRepos.length > 0) {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.worktree_creating',
          data: {
            workflowRunId: run.id,
            codebaseCount: gitRepos.length,
            codebases: gitRepos.map((r) => ({ alias: r.alias, codebaseId: r.url })),
          },
        });

        await this.preprocessor.cloneRepositories(gitRepos, {
          workflowRunId: run.id,
          variables: context.resolvedVariables,
          gitRepositories: gitRepos,
          clonedPaths: context.clonedRepositories,
          featureBranches: context.featureBranches,
          runWorkspaceDir: runWorkspaceDir,
        });

        // Store feature branches in context variables
        for (const [alias, branch] of Object.entries(context.featureBranches)) {
          context.resolvedVariables[`repo_branch_${alias}`] = branch;
        }

        // Update context variables with repo paths
        for (const [alias, repoPath] of Object.entries(context.clonedRepositories)) {
          context.resolvedVariables[`repo_path_${alias}`] = repoPath;
        }
      }

      // ── Workflow Hook: post_clone ──
      // Refresh hookCtx since workspace paths may have changed after clone
      const postCloneHookCtx = this.buildWorkflowHookContext(run.id, definition.id, context);
      await this.executeWorkflowHooks('post_clone', definition.hooks, postCloneHookCtx);

      // ── Phase 1.5: Wire project config cascades ──
      if (projectId && this.projectConfigService) {
        try {
          await this.wireProjectConfigs(projectId, run.id, context);
        } catch (err) {
          this.logger.warn(`[Orchestrator] Project config wiring failed (non-fatal): ${err}`);
        }
      }

      // ── Phase 2: Run preprocessing steps ──
      if (orchestratorConfig?.preprocessingSteps && orchestratorConfig.preprocessingSteps.length > 0) {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_started',
          data: {
            workflowRunId: run.id,
            stepCount: orchestratorConfig.preprocessingSteps.length,
          },
        });

        context.preprocessingResults = await this.preprocessor.execute(
          orchestratorConfig.preprocessingSteps,
          {
            workflowRunId: run.id,
            variables: context.resolvedVariables,
            gitRepositories: gitRepos,
            clonedPaths: context.clonedRepositories,
            featureBranches: context.featureBranches,
            runWorkspaceDir: runWorkspaceDir,
          },
        );

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_completed',
          data: {
            workflowRunId: run.id,
            results: context.preprocessingResults.map((r: PreprocessingResult) => ({
              stepName: r.stepName,
              success: r.success,
              durationMs: r.durationMs,
            })),
          },
        });
      }

      // ── Workflow Hook: on_preprocessing_complete ──
      const prepHookCtx = this.buildWorkflowHookContext(run.id, definition.id, context);
      await this.executeWorkflowHooks('on_preprocessing_complete', definition.hooks, prepHookCtx);

      // ── Phase 2.5: Copy workflow-level uploads to run ──
      // Workflow-level uploads are shared across all runs of a definition.
      await this.copyWorkflowUploadsToRun(definition.id, run.id);

      // ── Phase 3: Scan uploads directory for custom content ──
      // If files were uploaded via the /uploads endpoint, wire them
      // into the variables so StageExecutionService passes them to the SDK.
      try {
        await this.scanAndWireUploads(run.id, context);
      } catch (uploadErr) {
        this.logger.warn(`[Orchestrator] Upload scanning failed (non-fatal) for run ${run.id}: ${uploadErr}`);
      }

      // ── Phase 4: Update run variables with resolved values ──
      await this.runRepo.update(run.id, {
        variables: context.resolvedVariables,
      });

      // ── Phase 4.5: Create sandbox for this run (if sandbox mode is enabled) ──
      let sandboxSession: SandboxSession | undefined;

      if (this.sandboxLifecycleManager && this.sandboxProvider) {
        try {
          sandboxSession = await this.sandboxLifecycleManager.createForRun(
            run.id,
            runWorkspaceDir,
          );

          // Store sandbox name in context for downstream services
          this.setSystemVariable(context, '__sandboxName', sandboxSession.sandboxName);
          if (sandboxSession.cliUrl) {
            this.setSystemVariable(context, '__sandboxCliUrl', sandboxSession.cliUrl);
          }
          this.setSystemVariable(context, '__sandboxEnabled', 'true');

          await this.eventBus.emitGlobal({
            kind: 'workflow_run.sandbox_created',
            data: {
              workflowRunId: run.id,
              sandboxName: sandboxSession.sandboxName,
              cliUrl: sandboxSession.cliUrl ?? 'n/a',
              isDockerSandbox: sandboxSession.isDockerSandbox,
            },
          });

          this.logger.info(
            `[Orchestrator] Sandbox created for run ${run.id}: ${sandboxSession.sandboxName}`
          );
        } catch (sandboxErr) {
          this.logger.error(`[Orchestrator] Sandbox creation failed: ${sandboxErr}`);
          // Continue without sandbox — fallback to host execution
          sandboxSession = undefined;
        }
      }

      // ── Phase 5: Attach listeners BEFORE starting the DAG execution ──
      //
      // Item 10 — this used to happen AFTER `startRun()`, which raced a fast
      // run to zero: a run that completes before `startRun()` even returns
      // fired its completion event into a listener that did not exist yet,
      // so the run reported success and never ran auto-commit/auto-PR
      // post-processing. The listener itself also lived only in
      // memory — a server restart mid-run lost it entirely. Attaching first (and persisting the intent to the run's
      // `variables` column) closes both holes: `setupCompletionCleanup`
      // checks for an already-terminal run before subscribing, and
      // `reArmPendingPostProcessing()` (called once at boot) re-arms any run
      // whose persisted intent is still `pending`.

      await this.persistPostProcessingIntent(run.id, context, gitRepos, runWorkspaceDir);
      await this.setupCompletionCleanup(run.id, context, definition, gitRepos, runWorkspaceDir);

      // ── Phase 5: Start the DAG execution ──
      await this.workflowRunService.startRun(run.id);

      // ── Workflow Hook: on_all_stages_scheduled ──
      const schedHookCtx = this.buildWorkflowHookContext(run.id, definition.id, context);
      await this.executeWorkflowHooks('on_all_stages_scheduled', definition.hooks, schedHookCtx);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Mark run as failed
      await this.runRepo.update(run.id, {
        status: 'failed',
        error: `Orchestration failed: ${errorMsg}`,
        completedAt: new Date(),
      });

      await this.eventBus.emitGlobal({
        kind: 'workflow_run.orchestration_failed',
        data: { workflowRunId: run.id, error: errorMsg },
      });

      // Sandbox cleanup on failure
      if (this.sandboxLifecycleManager) {
        try {
          await this.sandboxLifecycleManager.destroyForRun(run.id);
          this.logger.info(`[Orchestrator] Sandbox destroyed after failure for run ${run.id}`);
        } catch (sandboxErr) {
          this.logger.warn(`[Orchestrator] Sandbox cleanup failed: ${sandboxErr}`);
        }
      }

      // Cleanup
      if (Object.keys(context.clonedRepositories).length > 0) {
        await this.preprocessor.cleanup(context.clonedRepositories);
      }
    }
  }

  /**
   * Extract workflowRunId from event data safely.
   */
  private getEventRunId(event: { data?: unknown }): string | undefined {
    if (event.data && typeof event.data === 'object' && 'workflowRunId' in event.data) {
      return String((event.data as Record<string, unknown>).workflowRunId);
    }
    return undefined;
  }

  /**
   * Item 10 — the actual "run finished" handling (post-processing / PR
   * creation / sandbox cleanup / completion hooks), factored out of the
   * event-listener callback so it can ALSO be invoked directly:
   *   - when `setupCompletionCleanup` discovers the run is already terminal
   *     at subscribe time (the completion event already fired and was
   *     missed — the race this item exists to close), and
   *   - from `reArmPendingPostProcessing()` on boot, for a run whose
   *     persisted intent (`__postProcessingIntent`) is still `pending`.
   *
   * Always clears the persisted intent when it finishes, success or not —
   * post-processing is best-effort and logged on failure, same as before;
   * this method does not retry.
   */
  private async handleRunTerminal(
    status: 'completed' | 'failed' | 'cancelled',
    runId: string,
    context: OrchestratorContext,
    definition: WorkflowDefinition,
    gitRepos: GitRepositoryConfig[],
    runWorkspaceDir: string,
  ): Promise<void> {
    const orchestratorConfig = definition.orchestratorConfig;

    // ── Post-Processing Phase ──
    // Only run post-processing on successful completion
    if (status === 'completed') {
      const postSteps = this.buildPostProcessingSteps(
        orchestratorConfig,
        gitRepos,
        context.clonedRepositories,
      );

      if (postSteps.length > 0) {
        try {
          // ── Workflow Hook: on_postprocessing_start ──
          const ppHookCtx = this.buildWorkflowHookContext(runId, definition.id, context);
          await this.executeWorkflowHooks('on_postprocessing_start', definition.hooks, ppHookCtx);

          // ── Workflow Hook: pre_commit ── (before auto-commit/PR steps)
          await this.executeWorkflowHooks('pre_commit', definition.hooks, ppHookCtx);

          await this.eventBus.emitGlobal({
            kind: 'workflow_run.postprocessing_started',
            data: { workflowRunId: runId, stepCount: postSteps.length },
          });

          context.postProcessingResults = await this.preprocessor.executePostProcessing(
            postSteps,
            {
              workflowRunId: runId,
              variables: context.resolvedVariables,
              gitRepositories: gitRepos,
              clonedPaths: context.clonedRepositories,
              featureBranches: context.featureBranches,
              runWorkspaceDir,
              workflowName: definition.name,
              ...(context.baseBranches ? { baseBranches: context.baseBranches } : {}),
            },
          );

          await this.eventBus.emitGlobal({
            kind: 'workflow_run.postprocessing_completed',
            data: {
              workflowRunId: runId,
              results: context.postProcessingResults.map((r: PreprocessingResult) => ({
                stepName: r.stepName,
                success: r.success,
                durationMs: r.durationMs,
              })),
            },
          });

          // ── Workflow Hook: post_commit ── (after auto-commit/PR steps)
          const postCommitHookCtx = this.buildWorkflowHookContext(runId, definition.id, context);
          await this.executeWorkflowHooks('post_commit', definition.hooks, postCommitHookCtx);

          // ── Workflow Hook: on_pr_created ── (HOOK-1: previously dormant)
          // Fire only when a create_pr post-processing step actually ran and
          // succeeded, so the phase reflects a real PR being opened.
          const prStep = postSteps.find((s) => s.config.type === 'create_pr');
          if (prStep) {
            const prResult = context.postProcessingResults?.find(
              (r: PreprocessingResult) => r.stepName === prStep.name,
            );
            if (prResult?.success) {
              await this.executeWorkflowHooks('on_pr_created', definition.hooks, postCommitHookCtx);
            }
          }
        } catch (postErr) {
          this.logger.error(`[Orchestrator] Post-processing failed for run ${runId}: ${postErr}`);
        }
      }
    }

    // Note: We do NOT cleanup per-run clones — they contain the generated code
    // that the user needs to review. The workspace is kept for inspection.

    // ── Sandbox Cleanup ──
    if (this.sandboxLifecycleManager) {
      try {
        await this.sandboxLifecycleManager.destroyForRun(runId);
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.sandbox_destroyed',
          data: { workflowRunId: runId },
        });
        this.logger.info(`[Orchestrator] Sandbox destroyed for completed run ${runId}`);
      } catch (sandboxErr) {
        this.logger.warn(`[Orchestrator] Sandbox cleanup failed for run ${runId}: ${sandboxErr}`);
      }
    }

    // ── Workflow Hooks: on_run_complete / on_run_failed / on_run_cancelled ──
    const completionHookCtx = this.buildWorkflowHookContext(runId, definition.id, context);
    if (status === 'completed') {
      await this.executeWorkflowHooks('on_run_complete', definition.hooks, completionHookCtx);
    } else if (status === 'failed') {
      await this.executeWorkflowHooks('on_run_failed', definition.hooks, completionHookCtx);
    } else if (status === 'cancelled') {
      await this.executeWorkflowHooks('on_run_cancelled', definition.hooks, completionHookCtx);
    }

    await this.eventBus.emitGlobal({
      kind: 'workflow_run.orchestration_completed',
      data: {
        workflowRunId: runId,
        preprocessingResults: context.preprocessingResults,
        postProcessingResults: context.postProcessingResults,
      },
    });

    await this.clearPostProcessingIntent(runId);
  }

  private isTerminalRunStatus(status: WorkflowRun['status']): status is 'completed' | 'failed' | 'cancelled' {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  /**
   * Setup cleanup when the workflow run completes.
   * Includes a safety timeout to prevent memory leaks.
   *
   * Item 10 — checks whether the run is ALREADY terminal before subscribing:
   * this is called BEFORE `startRun()` now (see the caller), so in the
   * normal case it never is, but a restart re-arming a run via
   * `reArmPendingPostProcessing()` very much can find one — the whole point
   * of that path is "the completion event already fired and was missed."
   * When that happens, post-process immediately instead of subscribing to
   * an event that will never come again.
   */
  private async setupCompletionCleanup(
    runId: string,
    context: OrchestratorContext,
    definition: WorkflowDefinition,
    gitRepos: GitRepositoryConfig[],
    runWorkspaceDir: string,
  ): Promise<void> {
    const MAX_LISTENER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    const current = await this.runRepo.getById(runId).catch(() => undefined);
    if (current && this.isTerminalRunStatus(current.status)) {
      await this.handleRunTerminal(current.status, runId, context, definition, gitRepos, runWorkspaceDir);
      return;
    }

    const unsubscribe = this.eventBus.subscribeGlobal(async (event) => {
      const eventRunId = this.getEventRunId(event);
      if (!eventRunId || eventRunId !== runId) return;

      if (
        event.kind === 'workflow_run.completed' ||
        event.kind === 'workflow_run.failed' ||
        event.kind === 'workflow_run.cancelled'
      ) {
        const status =
          event.kind === 'workflow_run.completed' ? 'completed'
          : event.kind === 'workflow_run.failed' ? 'failed'
          : 'cancelled';
        await this.handleRunTerminal(status, runId, context, definition, gitRepos, runWorkspaceDir);
        unsubscribe();
        clearTimeout(safetyTimeout);
      }
    });

    // Safety timeout: unsubscribe if the run never completes
    const safetyTimeout = setTimeout(() => {
      this.logger.warn(`[Orchestrator] Safety timeout: cleaning up completion listener for run ${runId}`);
      unsubscribe();
    }, MAX_LISTENER_TTL_MS);
  }

  /**
   * Item 10 — persists enough of the post-processing intent onto the run's
   * EXISTING `variables` JSON column (no migration) that a restarted process
   * can rebuild a minimal `OrchestratorContext` and re-arm
   * `setupCompletionCleanup` for it via `reArmPendingPostProcessing()`.
   * Namespaced with the same `__`-prefix convention as other
   * orchestrator-internal variables (see `setSystemVariable`) — the web UI
   * and CLI already filter those out of what they show the user.
   */
  private async persistPostProcessingIntent(
    runId: string,
    context: OrchestratorContext,
    gitRepos: GitRepositoryConfig[],
    runWorkspaceDir: string,
  ): Promise<void> {
    const intent: PersistedPostProcessingIntent = {
      pending: true,
      runWorkspaceDir,
      gitRepositories: gitRepos,
      clonedRepositories: context.clonedRepositories,
      featureBranches: context.featureBranches,
    };
    try {
      const run = await this.runRepo.getById(runId);
      await this.runRepo.update(runId, {
        variables: { ...run.variables, __postProcessingIntent: intent },
      });
    } catch (err) {
      this.logger.warn(`[Orchestrator] Failed to persist post-processing intent for run ${runId}: ${err}`);
    }
  }

  /** Item 10 — best-effort; a stale leftover intent is harmless (re-arm just re-checks a terminal run and no-ops if already handled). */
  private async clearPostProcessingIntent(runId: string): Promise<void> {
    try {
      const run = await this.runRepo.getById(runId);
      const variables = { ...(run.variables as Record<string, unknown>) };
      delete variables['__postProcessingIntent'];
      await this.runRepo.update(runId, { variables });
    } catch (err) {
      this.logger.warn(`[Orchestrator] Failed to clear post-processing intent for run ${runId}: ${err}`);
    }
  }

  /**
   * Item 10 — call once at boot, AFTER any run-recovery step, to re-arm
   * post-processing for every run whose intent is still `pending`: either
   * the process died between "run finished" and "post-processing ran", or
   * between attaching-before-start and the run actually finishing. A run
   * that is already terminal is post-processed immediately (via
   * `setupCompletionCleanup`'s own terminal check); one still in flight
   * gets its listener re-attached so a later completion is still caught.
   */
  async reArmPendingPostProcessing(): Promise<void> {
    let runs: WorkflowRun[];
    try {
      runs = await this.runRepo.getAll();
    } catch (err) {
      this.logger.warn(`[Orchestrator] reArmPendingPostProcessing: failed to list runs: ${err}`);
      return;
    }

    for (const run of runs) {
      const intent = (run.variables as Record<string, unknown> | undefined)?.[
        '__postProcessingIntent'
      ] as PersistedPostProcessingIntent | undefined;
      if (!intent?.pending) continue;

      try {
        const definition = await this.definitionService.getDefinition(run.workflowDefinitionId);
        const context: OrchestratorContext = {
          workflowRunId: run.id,
          workflowDefinitionId: run.workflowDefinitionId,
          clonedRepositories: intent.clonedRepositories ?? {},
          featureBranches: intent.featureBranches ?? {},
          resolvedVariables: { ...run.variables },
          preprocessingResults: [],
          postProcessingResults: [],
        };

        this.logger.info(
          `[Orchestrator] Re-arming post-processing for run ${run.id} (status=${run.status})`,
        );
        await this.setupCompletionCleanup(
          run.id,
          context,
          definition,
          intent.gitRepositories ?? [],
          intent.runWorkspaceDir ?? '',
        );
      } catch (err) {
        this.logger.warn(`[Orchestrator] Failed to re-arm post-processing for run ${run.id}: ${err}`);
      }
    }
  }

  /**
   * Build the list of post-processing steps to execute.
   * Combines explicit postProcessingSteps from config with auto-steps
   * (autoCommit / autoCreatePR flags).
   */
  private buildPostProcessingSteps(
    config: OrchestratorConfig | undefined,
    gitRepos: GitRepositoryConfig[],
    /** Worktrees created for this run, keyed by alias (project/codebase model). */
    clonedRepositories: Record<string, string> = {},
  ): PostProcessingStep[] {
    const steps: PostProcessingStep[] = [];
    // A run has something to commit if it either cloned legacy `gitRepositories`
    // or (the normal case now) had worktrees created from the project's
    // codebases. Gating on `gitRepos` alone meant autoCommit / autoCreatePR
    // never fired for ANY project-linked workflow — the only kind the builder
    // can create — because the project/codebase model leaves gitRepositories
    // empty and carries codebases through `codebaseAliases` + worktrees.
    const hasGitRepos = gitRepos.length > 0 || Object.keys(clonedRepositories).length > 0;

    // Explicit post-processing steps from config
    if (config?.postProcessingSteps) {
      steps.push(...config.postProcessingSteps);
    }

    // Auto-commit step (from autoCommit flag) — skip if explicit commit step exists
    //
    // `push` is `autoPush || autoCreatePR`: a PR needs a pushed head, so
    // asking for one implies the push even when `autoPush` was left off.
    // `generateMessage` hands the message to the flow's text generator, which
    // writes it from the actual diff — the interpolated template is kept as
    // the fallback for the legacy (no flow service) path.
    const hasExplicitCommit = steps.some((s) => s.config.type === 'commit_and_push');
    if (hasGitRepos && config?.autoCommit && !hasExplicitCommit) {
      steps.push({
        type: 'commit_and_push',
        name: 'Auto-commit changes',
        config: {
          type: 'commit_and_push',
          commitMessage: 'feat: GeneratorAI workflow changes (run {{__workflowRunId}})',
          generateMessage: true,
          push: config.autoPush === true || config.autoCreatePR === true,
        },
        // A failed commit means there is nothing to open a PR from, and a
        // conflict means the run's work is not on the branch it claims to be.
        // Either way the steps after this one must not run.
        failOnError: true,
        order: 100,
        enabled: true,
      });
    }

    // Auto-create PR step (from autoCreatePR flag) — skip if explicit PR step exists
    const hasExplicitPR = steps.some((s) => s.config.type === 'create_pr');
    if (hasGitRepos && config?.autoCreatePR && !hasExplicitPR) {
      steps.push({
        type: 'create_pr',
        name: 'Auto-create Pull Request',
        config: {
          type: 'create_pr',
          title: 'GeneratorAI: Workflow changes',
          body: 'Automated changes generated by GeneratorAI workflow run.',
          generateText: true,
        },
        failOnError: true,
        order: 200,
        enabled: true,
      });
    }

    return steps.sort((a, b) => a.order - b.order);
  }

  // ════════════════════════════════════════════════════════════════
  // Private — Upload Scanning
  // ════════════════════════════════════════════════════════════════

  /**
   * Scan the per-run uploads directory and wire found content into
   * context variables so StageExecutionService can pass them to the SDK.
   *
   * - uploads/skills/ → __skillDirectories (array of directory paths)
   * - uploads/agents/ → __customAgents (array of agent definition objects)
   * - uploads/prompts/ → __promptDirectories (array of directory paths)
   */
  private async scanAndWireUploads(
    runId: string,
    context: OrchestratorContext,
  ): Promise<void> {
    const uploadsDir = await this.getRunUploadsDir(runId);

    // Check skills directory
    const skillsDir = path.join(uploadsDir, 'skills');
    try {
      const skillFiles = await fs.readdir(skillsDir);
      if (skillFiles.length > 0) {
        const existing = (context.resolvedVariables['__skillDirectories'] as string[] | undefined) ?? [];
        context.resolvedVariables['__skillDirectories'] = [...existing, skillsDir];
        this.logger.info(`[Orchestrator] Wired ${skillFiles.length} skill files from uploads for run ${runId}`);
      }
    } catch {
      // Directory may not exist — no skills uploaded
    }

    // Check agents directory — parse .json/.md files as agent definitions
    const agentsDir = path.join(uploadsDir, 'agents');
    try {
      const agentFiles = await fs.readdir(agentsDir);
      if (agentFiles.length > 0) {
        const agents: unknown[] = [];
        for (const file of agentFiles) {
          const filePath = path.join(agentsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          if (file.endsWith('.json')) {
            try {
              agents.push(JSON.parse(content));
            } catch {
              this.logger.warn(`[Orchestrator] Failed to parse agent JSON: ${file}`);
            }
          } else {
            // Treat .md/.txt as agent instruction files
            agents.push({
              name: path.basename(file, path.extname(file)),
              description: `Custom agent from ${file}`,
              instructions: content,
            });
          }
        }
        if (agents.length > 0) {
          const existing = (context.resolvedVariables['__customAgents'] as unknown[] | undefined) ?? [];
          context.resolvedVariables['__customAgents'] = [...existing, ...agents];
          this.logger.info(`[Orchestrator] Wired ${agents.length} custom agents from uploads for run ${runId}`);
        }
      }
    } catch {
      // Directory may not exist — no agents uploaded
    }

    // Check prompts directory
    const promptsDir = path.join(uploadsDir, 'prompts');
    try {
      const promptFiles = await fs.readdir(promptsDir);
      if (promptFiles.length > 0) {
        const existing = (context.resolvedVariables['__promptDirectories'] as string[] | undefined) ?? [];
        context.resolvedVariables['__promptDirectories'] = [...existing, promptsDir];
        this.logger.info(`[Orchestrator] Wired ${promptFiles.length} prompt files from uploads for run ${runId}`);
      }
    } catch {
      // Directory may not exist — no prompts uploaded
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Private — Validation
  // ════════════════════════════════════════════════════════════════

  private validateRequiredVariables(
    definition: WorkflowDefinition,
    variables: Record<string, unknown>,
  ): void {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const varDef of definition.variables) {
      const val = variables[varDef.name];
      if (varDef.required && (val === undefined || val === '')) {
        missing.push(varDef.label || varDef.name);
      }
      // Validate choice variables have a value in the allowed options
      if (varDef.type === 'choice' && varDef.options && val !== undefined && val !== '') {
        if (!varDef.options.includes(String(val))) {
          invalid.push(`${varDef.label || varDef.name} (got '${String(val)}', expected one of: ${varDef.options.join(', ')})`);
        }
      }
    }
    if (missing.length > 0) {
      throw new ValidationError(
        `Missing required variables: ${missing.join(', ')}`,
      );
    }
    if (invalid.length > 0) {
      throw new ValidationError(
        `Invalid variable values: ${invalid.join('; ')}`,
      );
    }
  }

  /**
   * Set a system variable, warning (but not overwriting) if the user already defined it.
   */
  private setSystemVariable(
    context: OrchestratorContext,
    key: string,
    value: string,
  ): void {
    if (key in context.resolvedVariables) {
      this.logger.warn(
        `[Orchestrator] System variable '${key}' skipped: already defined by user as '${String(context.resolvedVariables[key])}'`,
      );
      return;
    }
    context.resolvedVariables[key] = value;
  }


  /**
   * Wire project-level agents/prompts/skills into the run's uploads directory.
   * This implements the config cascade: Global → Project → Workflow → Stage.
   */
  private async wireProjectConfigs(
    projectId: string,
    runId: string,
    context: OrchestratorContext,
  ): Promise<void> {
    if (!this.projectConfigService || !this.projectService) return;

    const configs = await this.projectConfigService.listConfigs(projectId);
    if (configs.length === 0) return;

    const runUploadsDir = await this.getRunUploadsDir(runId);

    for (const config of configs) {
      try {
        const content = await this.projectConfigService.getConfigContent(config.id);
        const categoryDir = `${config.type}s`; // agents, prompts, skills
        const destDir = path.join(runUploadsDir, categoryDir);
        await fs.mkdir(destDir, { recursive: true });
        const destPath = path.join(destDir, config.filePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        // Don't overwrite run-level or workflow-level uploads
        try {
          await fs.access(destPath);
          continue;
        } catch {
          // Not there — write it
        }
        await fs.writeFile(destPath, content);
      } catch (err) {
        this.logger.warn(`[Orchestrator] Failed to wire project config "${config.name}": ${err}`);
      }
    }

    this.logger.info(`[Orchestrator] Wired ${configs.length} project configs for run ${runId}`);
  }
}
