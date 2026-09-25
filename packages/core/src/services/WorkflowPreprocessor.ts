// ────────────────────────────────────────────────────────────────
// WorkflowPreprocessor — Handles pre-processing steps before
// workflow DAG execution: git cloning, script running, input
// validation, variable resolution, and conditional logic.
// ────────────────────────────────────────────────────────────────

import type {
  PreprocessingResult,
  ILogger,
  ScmFlowRequest,
  ScmFlowResult,
} from '@generatorai/shared';
import {
  compileSafeRegex,
  evaluateSource,
  renderTemplate,
  type PostProcessingStep,
  type PreprocessingStep,
} from '@generatorai/workflow-spec';
import { codebasesOf, userVariables } from './definitions/runScope.js';

type PreConfig = PreprocessingStep['config'];
type PostConfig = PostProcessingStep['config'];
type CloneRepoStepConfig = Extract<PreConfig, { type: 'clone_repo' }>;
type RunScriptStepConfig = Extract<PreConfig, { type: 'run_script' }>;
type ValidateInputStepConfig = Extract<PreConfig, { type: 'validate_input' }>;
type SetVariableStepConfig = Extract<PreConfig, { type: 'set_variable' }>;
type ConditionalStepConfig = Extract<PreConfig, { type: 'conditional' }>;
type CommitAndPushStepConfig = Extract<PostConfig, { type: 'commit_and_push' }>;
type CreatePRStepConfig = Extract<PostConfig, { type: 'create_pr' }>;
type PostRunScriptStepConfig = Extract<PostConfig, { type: 'run_script' }>;
import type { GitManager } from '../infrastructure/GitManager.js';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { EventBus } from '../events/EventBus.js';
import * as path from 'node:path';

/**
 * The slice of `SourceControlFlowService` post-processing needs (doc §5).
 *
 * A port rather than the class so the preprocessor keeps no dependency on the
 * git client, the account registry or the text generator — and so the routing
 * can be tested with a fake that returns canned `ScmFlowResult`s.
 */
export interface WorkflowScmFlowPort {
  run(input: {
    workspaceId?: string;
    repoDir: string;
    alias: string;
    request: ScmFlowRequest;
    context?: { chatName?: string; hint?: string };
  }): Promise<ScmFlowResult>;
}

/**
 * A post-processing step that could not complete because source control said
 * no. Carries the `ScmFlowResult`s so the run page can render the conflict
 * report / blocking reason instead of a bare message.
 */
export class ScmPostProcessingError extends Error {
  constructor(
    message: string,
    readonly results: ScmFlowResult[],
  ) {
    super(message);
    this.name = 'ScmPostProcessingError';
  }
}

/**
 * Render a lifecycle template (commit message, PR text, set_variable value)
 * with Expression v2: `variables.*` (bare `{{name}}` is sugar) and the
 * read-only `run.codebases.<alias>`.
 */
function renderLifecycleTemplate(text: string, context: PreprocessorContext): string {
  const result = renderTemplate(text, {
    variables: userVariables(context.variables),
    run: { id: context.workflowRunId, name: context.workflowName ?? '', codebases: codebasesOf(context.variables) },
  });
  if (!result.ok) throw new Error(`Template error (${result.error.code}): ${result.error.message}`);
  return result.text;
}

/** One user-facing line explaining a flow result that did not succeed. */
export function scmFailureReason(result: ScmFlowResult): string {
  if (result.status === 'conflicts') {
    const files = result.conflicts?.files ?? [];
    return (
      `${result.alias}: merge conflicts with ${result.conflicts?.base ?? 'the base branch'} in ` +
      `${files.length} file(s)${files.length ? ` (${files.slice(0, 5).join(', ')})` : ''}` +
      ' — the working tree was left untouched'
    );
  }
  if (result.error) return `${result.alias}: ${result.error}`;
  const stopped = result.steps.find((s) => s.status === 'blocked' || s.status === 'failed');
  return `${result.alias}: ${stopped?.detail ?? 'the source-control flow did not complete'}`;
}

/** Max bytes per `GEN_VAR_*` env var value — prevents blowing past ARG_MAX. */
const MAX_ENV_VALUE_BYTES = 32 * 1024;

/**
 * Build the `GEN_VAR_*` environment for a script step. Variables flow into
 * scripts via env — NEVER interpolated into shell strings — so the shell never
 * sees user-controlled metacharacters. This function also:
 *   - skips keys that aren't valid POSIX identifiers (prevents `GEN_VAR_a.b=`
 *     and worse — values containing `=` or shell-splittable bytes via a bad key)
 *   - truncates oversized values so one big variable can't overflow ARG_MAX
 *   - silently skips null/undefined
 *
 * Phase 2, 2.14 — if you ever need to interpolate a variable into the script
 * string directly, shell-quote it (`'${v//\'/\'\\\'\'}'`) or don't.
 */
function buildGenVarEnv(variables: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (Buffer.byteLength(str, 'utf8') > MAX_ENV_VALUE_BYTES) {
      str = str.slice(0, MAX_ENV_VALUE_BYTES) + '…[truncated]';
    }
    env[`GEN_VAR_${key}`] = str;
  }
  return env;
}

/** A repository a `clone_repo` step clones, named by the run's inputs. */
export interface RunRepository {
  alias: string;
  url: string;
  branch?: string;
}

export interface PreprocessorContext {
  workflowRunId: string;
  variables: Record<string, unknown>;
  clonedPaths: Record<string, string>;
  featureBranches: Record<string, string>;
  /** Per-run workspace directory where repos are cloned into */
  runWorkspaceDir: string;
  /** Workflow name — seeds the generated commit message / PR text. */
  workflowName?: string;
  /** Base branch per repo alias (the codebase's `defaultBranch`). */
  baseBranches?: Record<string, string>;
}

/** What one post-processing step produced. */
interface PostStepOutcome {
  output?: string;
  scm?: ScmFlowResult[];
}

export class WorkflowPreprocessor {
  constructor(
    private readonly gitManager: GitManager,
    private readonly scriptRunner: IScriptRunner,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    /**
     * Agent-native source control (doc §5). Commit/push/PR post-processing
     * runs through the ONE flow that also serves the Changes tab and
     * agent-native chats — same branch policy, same base-branch sync, same
     * conflict dry-run.
     */
    private readonly scmFlow: WorkflowScmFlowPort,
  ) {}

  /**
   * Execute all preprocessing steps in order.
   * Clones repositories, runs scripts, validates inputs, sets variables.
   */
  async execute(
    steps: readonly PreprocessingStep[],
    context: PreprocessorContext,
  ): Promise<PreprocessingResult[]> {
    const results: PreprocessingResult[] = [];

    for (const step of steps) {
      const start = Date.now();
      try {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_started',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            stepType: step.config.type,
          },
        });

        const output = await this.executeStep(step, context);

        const result: PreprocessingResult = {
          stepName: step.name,
          success: true,
          output,
          durationMs: Date.now() - start,
        };
        results.push(result);

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_completed',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            success: true,
            durationMs: result.durationMs,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const result: PreprocessingResult = {
          stepName: step.name,
          success: false,
          error: errorMsg,
          durationMs: Date.now() - start,
        };
        results.push(result);

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_failed',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            error: errorMsg,
          },
        });

        if (step.failOnError) {
          this.logger.error(`[Preprocessor] Step "${step.name}" failed and failOnError=true: ${errorMsg}`);
          throw new Error(`Preprocessing step "${step.name}" failed: ${errorMsg}`);
        }

        this.logger.warn(`[Preprocessor] Step "${step.name}" failed (non-fatal): ${errorMsg}`);
      }
    }

    return results;
  }

  /**
   * Execute post-processing steps after workflow stages complete.
   */
  async executePostProcessing(
    steps: readonly PostProcessingStep[],
    context: PreprocessorContext,
  ): Promise<PreprocessingResult[]> {
    const results: PreprocessingResult[] = [];

    for (const step of steps) {
      const start = Date.now();
      try {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.postprocessing_step_started',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            stepType: step.config.type,
          },
        });

        const outcome = await this.executePostStep(step, context);

        const result: PreprocessingResult = {
          stepName: step.name,
          success: true,
          ...(outcome.output !== undefined ? { output: outcome.output } : {}),
          ...(outcome.scm ? { scm: outcome.scm } : {}),
          durationMs: Date.now() - start,
        };
        results.push(result);

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.postprocessing_step_completed',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            success: true,
            durationMs: result.durationMs,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // A source-control failure carries the full `ScmFlowResult`s — the
        // conflict report, the blocking reason, which steps ran — so the run
        // page can explain what happened rather than showing one line.
        const scm = error instanceof ScmPostProcessingError ? error.results : undefined;
        const result: PreprocessingResult = {
          stepName: step.name,
          success: false,
          error: errorMsg,
          ...(scm ? { scm } : {}),
          durationMs: Date.now() - start,
        };
        results.push(result);

        await this.eventBus.emitGlobal({
          kind: 'workflow_run.postprocessing_step_failed',
          data: {
            workflowRunId: context.workflowRunId,
            stepName: step.name,
            error: errorMsg,
          },
        });

        if (step.failOnError) {
          this.logger.error(`[Preprocessor] Post-step "${step.name}" failed: ${errorMsg}`);
          break;
        }
        this.logger.warn(`[Preprocessor] Post-step "${step.name}" failed (non-fatal): ${errorMsg}`);
      }
    }

    return results;
  }

  /**
   * Cleanup cloned repositories after workflow completion.
   */
  async cleanup(clonedPaths: Record<string, string>): Promise<void> {
    for (const [alias, repoPath] of Object.entries(clonedPaths)) {
      try {
        await this.gitManager.cleanup(repoPath);
        this.logger.info(`[Preprocessor] Cleaned up repo "${alias}" at ${repoPath}`);
      } catch (error) {
        this.logger.warn(`[Preprocessor] Failed to cleanup repo "${alias}": ${error}`);
      }
    }
  }

  // ── Private Step Executors ──

  private async executePostStep(
    step: PostProcessingStep,
    context: PreprocessorContext,
  ): Promise<PostStepOutcome> {
    const config = step.config;

    switch (config.type) {
      case 'commit_and_push':
        return this.executeCommitAndPush(config, context);
      case 'create_pr':
        return this.executeCreatePR(config, context);
      case 'run_script':
        return { output: await this.executePostRunScript(config, context) };
      default:
        throw new Error(`Unknown post-processing step type: ${(config as { type: string }).type}`);
    }
  }

  // ── Source-control flow routing (doc §5) ─────────────────────────────
  //
  // `commit_and_push` and `create_pr` are the SAME flow with different
  // requested steps, so they share one runner: resolve the repos, run
  // `SourceControlFlowService.run` per repo, and fail the step when any of
  // them comes back `conflicts` / `blocked` / `failed`. The flow's sync step
  // probes the merge without touching the working tree, so a step that fails
  // this way never leaves a half-applied merge behind.

  /** The repos a post-processing step acts on, in a stable order. */
  private scmTargets(
    repoAlias: string | undefined,
    context: PreprocessorContext,
  ): Array<{ alias: string; repoDir: string }> {
    const aliases = repoAlias ? [repoAlias] : Object.keys(context.clonedPaths);
    const out: Array<{ alias: string; repoDir: string }> = [];
    for (const alias of aliases) {
      const repoDir = context.clonedPaths[alias];
      if (!repoDir) {
        this.logger.warn(`[Preprocessor] No cloned path for alias "${alias}", skipping`);
        continue;
      }
      out.push({ alias, repoDir });
    }
    return out;
  }

  /** Hint the generated commit message / PR text is written from. */
  private scmHint(context: PreprocessorContext): string {
    const name = context.workflowName?.trim();
    return name
      ? `${name} (workflow run ${context.workflowRunId})`
      : `Workflow run ${context.workflowRunId}`;
  }

  /**
   * Run one flow request per repo and summarise. Throws
   * `ScmPostProcessingError` — with every result attached — as soon as one
   * repo does not come back `ok`.
   */
  private async runScmFlow(
    targets: Array<{ alias: string; repoDir: string }>,
    context: PreprocessorContext,
    build: (alias: string) => ScmFlowRequest,
    describe: (result: ScmFlowResult) => string,
  ): Promise<PostStepOutcome> {
    const flow = this.scmFlow;
    const results: ScmFlowResult[] = [];
    const lines: string[] = [];
    const hint = this.scmHint(context);

    for (const target of targets) {
      const result = await flow.run({
        repoDir: target.repoDir,
        alias: target.alias,
        request: { ...build(target.alias), hint },
        context: { hint },
      });
      results.push(result);
      if (result.status !== 'ok') {
        throw new ScmPostProcessingError(scmFailureReason(result), results);
      }
      lines.push(describe(result));
    }

    return { output: lines.join('; '), scm: results };
  }

  private async executeCommitAndPush(
    config: CommitAndPushStepConfig,
    context: PreprocessorContext,
  ): Promise<PostStepOutcome> {
    const message = renderLifecycleTemplate(config.commitMessage, context);
    const targets = this.scmTargets(config.repoAlias, context);

    if (!config.repoAlias && targets.length > 1) {
      this.logger.info(`[Preprocessor] Auto-committing all ${targets.length} run repos`);
    }

    const push = config.push !== false;
    return this.runScmFlow(
      targets,
      context,
      (alias) => ({
        alias,
        commit: config.generateMessage
          ? { generate: true }
          : { message, generate: false },
        push,
        // No `pullRequest` here, so the sync step falls back to the repo's
        // own default branch — which is what a commit-only step wants.
      }),
      (result) => {
        const sha = result.commit?.sha.slice(0, 8);
        const where = result.branch ?? result.readiness.branch ?? 'HEAD';
        if (!sha) return `${result.alias}: nothing to commit on ${where}`;
        return `${result.alias}: committed ${sha} on ${where}${result.pushed ? ' and pushed' : ''}`;
      },
    );
  }

  /** Explicit base > the codebase's default branch > let the flow resolve it. */
  private baseFor(
    explicit: string | undefined,
    alias: string,
    context: PreprocessorContext,
  ): string | undefined {
    return explicit ?? context.baseBranches?.[alias];
  }

  private async executeCreatePR(
    config: CreatePRStepConfig,
    context: PreprocessorContext,
  ): Promise<PostStepOutcome> {
    const title = renderLifecycleTemplate(config.title, context);
    const body = renderLifecycleTemplate(config.body, context);
    const targets = this.scmTargets(config.repoAlias, context);

    if (!config.repoAlias && targets.length > 1) {
      this.logger.info(`[Preprocessor] Auto-creating PR for all ${targets.length} run repos`);
    }

    return this.runScmFlow(
      targets,
      context,
      (alias) => {
        const base = this.baseFor(config.baseBranch, alias, context);
        return {
          alias,
          push: true,
          pullRequest: {
            ...(config.generateText
              ? { generate: true }
              : { title, body, generate: false }),
            ...(base ? { base } : {}),
            ...(config.draft !== undefined ? { draft: config.draft } : {}),
          },
        };
      },
      (result) => {
        const pr = result.pullRequest;
        return pr
          ? `PR #${pr.number} created for ${result.alias}: ${pr.url}`
          : `${result.alias}: no pull request was opened`;
      },
    );
  }

  private async executePostRunScript(
    config: PostRunScriptStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    const env = buildGenVarEnv(context.variables);
    const cwd = config.cwd ? path.resolve(context.runWorkspaceDir, config.cwd) : undefined;

    const result = await this.scriptRunner.run('sh', ['-c', config.script], {
      cwd: cwd ?? context.runWorkspaceDir,
      timeout: config.timeoutMs ?? 60_000,
      env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Post-run script failed (exit ${result.exitCode}): ${result.stderr}`);
    }

    return result.stdout;
  }

  private async executeStep(
    step: PreprocessingStep,
    context: PreprocessorContext,
  ): Promise<string | undefined> {
    const config = step.config;

    switch (config.type) {
      case 'clone_repo':
        return this.executeCloneRepo(config, context);
      case 'run_script':
        return this.executeRunScript(config, context);
      case 'validate_input':
        return this.executeValidateInput(config, context);
      case 'set_variable':
        return this.executeSetVariable(config, context);
      case 'conditional':
        return this.executeConditional(config, context);
      default:
        throw new Error(`Unknown preprocessing step type: ${(config as { type: string }).type}`);
    }
  }

  private async executeCloneRepo(
    config: CloneRepoStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    // A checkout the run already has for this alias (a project worktree)
    // is what the step exists to produce.
    const existing = context.variables[`repo_path_${config.repoAlias}`];
    if (typeof existing === 'string' && existing) return existing;
    const repo = repositoryFromInputs(config.repoAlias, context.variables);
    if (!repo) {
      throw new Error(
        `No repository to clone for "${config.repoAlias}". Enter a repository URL or run the workflow in a project.`,
      );
    }

    // Skip if an earlier step already cloned it
    if (context.clonedPaths[repo.alias]) {
      const existingPath = context.clonedPaths[repo.alias]!;
      this.logger.info(`[Preprocessor] Repo "${repo.alias}" already cloned at ${existingPath}, skipping`);
      return existingPath;
    }

    // Per-run workspace directory for isolation
    const targetDir = path.join(context.runWorkspaceDir, repo.alias);
    const clonedPath = await this.gitManager.cloneToDirectory(repo.url, targetDir, repo.branch);
    context.clonedPaths[repo.alias] = clonedPath;
    context.variables[`repo_path_${repo.alias}`] = clonedPath;
    return clonedPath;
  }

  private async executeRunScript(
    config: RunScriptStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    // Pass variables as environment variables instead of interpolating into shell commands.
    // This prevents command injection via user-supplied variable values.
    const env = buildGenVarEnv(context.variables);

    // The script is a literal (templates are rejected at save time);
    // variables reach it only as GEN_VAR_* env values.
    const cwd = config.cwd ? path.resolve(context.runWorkspaceDir, config.cwd) : undefined;

    const result = await this.scriptRunner.run('sh', ['-c', config.script], {
      cwd: cwd ?? context.runWorkspaceDir,
      timeout: config.timeoutMs ?? 60_000,
      env,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Script failed (exit ${result.exitCode}): ${result.stderr}`);
    }

    return result.stdout;
  }

  private async executeValidateInput(
    config: ValidateInputStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    const value = context.variables[config.variableName];

    for (const rule of config.rules) {
      switch (rule.type) {
        case 'required':
          if (value === undefined || value === null || value === '') {
            throw new Error(rule.message);
          }
          break;
        case 'regex': {
          // Linear-time engine: a pathological pattern cannot stall the event loop (RV-21).
          const compiled = compileSafeRegex(rule.pattern, rule.flags ?? '');
          if (!compiled.ok) throw new Error(`Invalid pattern for ${config.variableName}: ${compiled.error.message}`);
          if (!compiled.regex.test(String(value))) {
            throw new Error(rule.message);
          }
          break;
        }
        case 'min_length':
          if (String(value ?? '').length < rule.value) {
            throw new Error(rule.message);
          }
          break;
        case 'max_length':
          if (String(value ?? '').length > rule.value) {
            throw new Error(rule.message);
          }
          break;
      }
    }

    return `Validation passed for ${config.variableName}`;
  }

  private async executeSetVariable(
    config: SetVariableStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    if (!/^[a-zA-Z_]\w*$/.test(config.variableName)) {
      throw new Error(`Invalid variable name: '${config.variableName}'. Must start with a letter or underscore and contain only word characters.`);
    }
    if (config.variableName.startsWith('__')) {
      throw new Error(`Variable name '${config.variableName}' uses reserved '__' prefix.`);
    }
    const resolvedValue = renderLifecycleTemplate(config.value, context);
    context.variables[config.variableName] = resolvedValue;
    return `Set ${config.variableName} = ${resolvedValue}`;
  }

  private async executeConditional(
    config: ConditionalStepConfig,
    context: PreprocessorContext,
  ): Promise<string> {
    const conditionResult = this.conditionHolds(config.condition, context.variables);

    if (conditionResult) {
      const results = await this.execute(config.thenSteps, context);
      return `Condition true: executed ${results.length} then-steps`;
    } else if (config.elseSteps && config.elseSteps.length > 0) {
      const results = await this.execute(config.elseSteps, context);
      return `Condition false: executed ${results.length} else-steps`;
    }

    return 'Condition false: no else-steps';
  }

  // ── Utilities ──

  /**
   * Evaluate a conditional step's Expression v2 condition over `variables.*`.
   * A condition that does not parse fails the step (its failOnError decides
   * whether the run fails) instead of silently taking the else branch.
   */
  private conditionHolds(condition: string, variables: Record<string, unknown>): boolean {
    const result = evaluateSource(condition, { variables: userVariables(variables) });
    if (!result.ok) {
      throw new Error(`Invalid condition "${condition}": ${result.error.message}`);
    }
    return result.value === true;
  }
}

/**
 * The input names a template uses for "the repository to work on".
 *
 * A template's repository URL is only known at run time: the URL the user
 * typed into the run form is the repository the step means.
 */
const REPOSITORY_INPUTS = ['git_url', 'repo_url', 'repository_url', 'repository'] as const;

export function repositoryFromInputs(
  alias: string,
  variables: Record<string, unknown>,
): RunRepository | null {
  for (const name of REPOSITORY_INPUTS) {
    const url = variables[name];
    if (typeof url === 'string' && url.trim()) {
      const branch = variables['branch'];
      return {
        alias,
        url: url.trim(),
        ...(typeof branch === 'string' && branch.trim() ? { branch: branch.trim() } : {}),
      };
    }
  }
  return null;
}
