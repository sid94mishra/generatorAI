// ────────────────────────────────────────────────────────────────
// Lifecycle steps — the definition's preprocessing steps (the `preprocess`
// phase of `starting`) and post-processing steps (the `postProcess` phase
// of `finalizing`). Ported from the deleted run orchestrator's
// preprocessor (P04 WP-4.1), with the C-20 fixes:
//   - `run_script` runs in the run's working directory, through the
//     platform's shell (`pwsh -NoProfile -Command` on Windows, `sh -c`
//     elsewhere); variables reach it only as `GEN_VAR_*` env values;
//   - `clone_repo` accepts https and ssh remotes only (the clone itself
//     passes `--` before the URL);
//   - commit/push/PR go through the ONE source-control flow chats use, on
//     the run's codebases, and a pull request targets the base ref the
//     codebase was mounted from.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import type { ILogger, PreprocessingResult, RunCodebase, ScmFlowRequest, ScmFlowResult } from '@generatorai/shared';
import {
  compileSafeRegex,
  evaluateSource,
  renderTemplate,
  type PostProcessingStep,
  type PreprocessingStep,
} from '@generatorai/workflow-spec';
import type { IScriptRunner } from '../../../domain/ports/IScriptRunner.js';
import type { EventBus } from '../../../events/EventBus.js';
import type { GitManager } from '../../../infrastructure/GitManager.js';

type PreConfig = PreprocessingStep['config'];
type PostConfig = PostProcessingStep['config'];
type CloneRepoStepConfig = Extract<PreConfig, { type: 'clone_repo' }>;
type RunScriptStepConfig = Extract<PreConfig, { type: 'run_script' }>;
type ValidateInputStepConfig = Extract<PreConfig, { type: 'validate_input' }>;
type SetVariableStepConfig = Extract<PreConfig, { type: 'set_variable' }>;
type ConditionalStepConfig = Extract<PreConfig, { type: 'conditional' }>;
type CommitAndPushStepConfig = Extract<PostConfig, { type: 'commit_and_push' }>;
type CreatePRStepConfig = Extract<PostConfig, { type: 'create_pr' }>;

/**
 * The slice of `SourceControlFlowService` post-processing needs (doc §5).
 *
 * A port rather than the class so the lifecycle keeps no dependency on the
 * git client, the account registry or the text generator — and so the
 * routing can be tested with a fake that returns canned `ScmFlowResult`s.
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

/** What the steps read and write. */
export interface LifecycleStepContext {
  runId: string;
  runName?: string;
  /** Seeds the generated commit message / PR text. */
  workflowName?: string;
  workspaceId?: string;
  /** The run's working directory (its primary mount): scripts and clones run here. */
  workDir: string;
  /** The run's user variables; `set_variable` writes here. */
  variables: Record<string, unknown>;
  /** `run.codebases`; `clone_repo` adds its checkout here. */
  codebases: Record<string, RunCodebase>;
}

/** Max bytes per `GEN_VAR_*` env var value — prevents blowing past ARG_MAX. */
const MAX_ENV_VALUE_BYTES = 32 * 1024;

/**
 * The `GEN_VAR_*` environment of a script step. Variables flow into scripts
 * through env — NEVER interpolated into shell strings — so the shell never
 * sees user-controlled metacharacters. Keys that are not POSIX identifiers
 * are skipped and oversized values truncated.
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

/** The platform's shell for a script step (C-20). */
export function scriptShell(script: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  return platform === 'win32'
    ? { command: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
    : { command: 'sh', args: ['-c', script] };
}

/** Remotes a `clone_repo` step may clone: https and ssh (URL or scp-like `user@host:path`). */
export function isAllowedCloneUrl(url: string): boolean {
  if (/^https:\/\/[^\s]+$/i.test(url)) return true;
  if (/^ssh:\/\/[^\s]+$/i.test(url)) return true;
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s-][^\s]*$/.test(url);
}

/** A repository a `clone_repo` step clones, named by the run's inputs. */
export interface RunRepository {
  alias: string;
  url: string;
  branch?: string;
}

/**
 * The input names a template uses for "the repository to work on": the URL
 * the user typed into the run form is the repository the step means.
 */
const REPOSITORY_INPUTS = ['git_url', 'repo_url', 'repository_url', 'repository'] as const;

export function repositoryFromInputs(alias: string, variables: Record<string, unknown>): RunRepository | null {
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

/** What one post-processing step produced. */
interface PostStepOutcome {
  output?: string;
  scm?: ScmFlowResult[];
}

/** The PR base of a codebase: its mount's base ref as a branch name (`origin/main` → `main`). */
export function prBaseOf(codebase: RunCodebase | undefined): string | undefined {
  const ref = codebase?.baseRef;
  if (!ref || ref === 'HEAD') return undefined;
  return ref.replace(/^origin\//, '');
}

export class LifecycleSteps {
  constructor(
    private readonly gitManager: Pick<GitManager, 'cloneToDirectory'>,
    private readonly scriptRunner: IScriptRunner,
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    /**
     * Agent-native source control (doc §5). Commit/push/PR post-processing
     * runs through the ONE flow that also serves the Changes tab and chats —
     * same branch policy, same base-branch sync, same conflict dry-run.
     */
    private readonly scmFlow: WorkflowScmFlowPort,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** Render a lifecycle template (commit message, PR text, set_variable value) with Expression v2. */
  private render(text: string, ctx: LifecycleStepContext): string {
    const codebases = Object.fromEntries(
      Object.entries(ctx.codebases).map(([alias, c]) => [alias, { path: c.path, branch: c.branch, baseRef: c.baseRef }]),
    );
    const result = renderTemplate(text, {
      variables: ctx.variables,
      run: { id: ctx.runId, name: ctx.runName ?? ctx.workflowName ?? '', codebases },
    });
    if (!result.ok) throw new Error(`Template error (${result.error.code}): ${result.error.message}`);
    return result.text;
  }

  /** Every preprocessing step in order; a failing `failOnError` step throws. */
  async execute(steps: readonly PreprocessingStep[], ctx: LifecycleStepContext): Promise<PreprocessingResult[]> {
    const results: PreprocessingResult[] = [];
    for (const step of steps) {
      const start = Date.now();
      try {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_started',
          data: { workflowRunId: ctx.runId, stepName: step.name, stepType: step.config.type },
        });
        const output = await this.executeStep(step, ctx);
        const result: PreprocessingResult = { stepName: step.name, success: true, output, durationMs: Date.now() - start };
        results.push(result);
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_completed',
          data: { workflowRunId: ctx.runId, stepName: step.name, success: true, durationMs: result.durationMs },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ stepName: step.name, success: false, error: errorMsg, durationMs: Date.now() - start });
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.preprocessing_step_failed',
          data: { workflowRunId: ctx.runId, stepName: step.name, error: errorMsg },
        });
        if (step.failOnError) throw new Error(`Preprocessing step "${step.name}" failed: ${errorMsg}`);
        this.logger.warn(`[LifecycleSteps] Step "${step.name}" failed (non-fatal): ${errorMsg}`);
      }
    }
    return results;
  }

  /**
   * Post-processing steps after the stages. A failing `failOnError` step
   * stops the ones after it; the caller decides what the failure means.
   */
  async executePostProcessing(steps: readonly PostProcessingStep[], ctx: LifecycleStepContext): Promise<PreprocessingResult[]> {
    const results: PreprocessingResult[] = [];
    for (const step of steps) {
      const start = Date.now();
      try {
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.postprocessing_step_started',
          data: { workflowRunId: ctx.runId, stepName: step.name, stepType: step.config.type },
        });
        const outcome = await this.executePostStep(step, ctx);
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
          data: { workflowRunId: ctx.runId, stepName: step.name, success: true, durationMs: result.durationMs },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // A source-control failure carries the full `ScmFlowResult`s — the
        // conflict report, the blocking reason, which steps ran.
        const scm = error instanceof ScmPostProcessingError ? error.results : undefined;
        results.push({ stepName: step.name, success: false, error: errorMsg, ...(scm ? { scm } : {}), durationMs: Date.now() - start });
        await this.eventBus.emitGlobal({
          kind: 'workflow_run.postprocessing_step_failed',
          data: { workflowRunId: ctx.runId, stepName: step.name, error: errorMsg },
        });
        if (step.failOnError) {
          this.logger.error(`[LifecycleSteps] Post-step "${step.name}" failed: ${errorMsg}`);
          break;
        }
        this.logger.warn(`[LifecycleSteps] Post-step "${step.name}" failed (non-fatal): ${errorMsg}`);
      }
    }
    return results;
  }

  // ── Post-processing ─────────────────────────────────────────

  private async executePostStep(step: PostProcessingStep, ctx: LifecycleStepContext): Promise<PostStepOutcome> {
    const config = step.config;
    switch (config.type) {
      case 'commit_and_push':
        return this.executeCommitAndPush(config, ctx);
      case 'create_pr':
        return this.executeCreatePR(config, ctx);
      case 'run_script':
        return { output: await this.runScript(config, ctx, 'Post-run script') };
      default:
        throw new Error(`Unknown post-processing step type: ${(config as { type: string }).type}`);
    }
  }

  /** The codebases a post-processing step acts on, in a stable order. */
  private scmTargets(repoAlias: string | undefined, ctx: LifecycleStepContext): Array<{ alias: string; repoDir: string }> {
    const aliases = repoAlias ? [repoAlias] : Object.keys(ctx.codebases);
    const out: Array<{ alias: string; repoDir: string }> = [];
    for (const alias of aliases) {
      const repoDir = ctx.codebases[alias]?.path;
      if (!repoDir) {
        this.logger.warn(`[LifecycleSteps] The run has no codebase "${alias}", skipping`);
        continue;
      }
      out.push({ alias, repoDir });
    }
    return out;
  }

  /** Hint the generated commit message / PR text is written from. */
  private scmHint(ctx: LifecycleStepContext): string {
    const name = ctx.workflowName?.trim();
    return name ? `${name} (workflow run ${ctx.runId})` : `Workflow run ${ctx.runId}`;
  }

  /**
   * One flow request per repo. Throws `ScmPostProcessingError` — with every
   * result attached — as soon as one repo does not come back `ok`.
   */
  private async runScmFlow(
    targets: Array<{ alias: string; repoDir: string }>,
    ctx: LifecycleStepContext,
    build: (alias: string) => ScmFlowRequest,
    describe: (result: ScmFlowResult) => string,
  ): Promise<PostStepOutcome> {
    const results: ScmFlowResult[] = [];
    const lines: string[] = [];
    const hint = this.scmHint(ctx);
    for (const target of targets) {
      const result = await this.scmFlow.run({
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
        repoDir: target.repoDir,
        alias: target.alias,
        request: { ...build(target.alias), hint },
        context: { hint },
      });
      results.push(result);
      if (result.status !== 'ok') throw new ScmPostProcessingError(scmFailureReason(result), results);
      lines.push(describe(result));
    }
    return { output: lines.join('; '), scm: results };
  }

  private async executeCommitAndPush(config: CommitAndPushStepConfig, ctx: LifecycleStepContext): Promise<PostStepOutcome> {
    const message = this.render(config.commitMessage, ctx);
    const targets = this.scmTargets(config.repoAlias, ctx);
    const push = config.push !== false;
    return this.runScmFlow(
      targets,
      ctx,
      (alias) => ({
        alias,
        commit: config.generateMessage ? { generate: true } : { message, generate: false },
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

  private async executeCreatePR(config: CreatePRStepConfig, ctx: LifecycleStepContext): Promise<PostStepOutcome> {
    const title = this.render(config.title, ctx);
    const body = this.render(config.body, ctx);
    const targets = this.scmTargets(config.repoAlias, ctx);
    return this.runScmFlow(
      targets,
      ctx,
      (alias) => {
        // Explicit base > the base ref the codebase was mounted from > the flow's own resolution.
        const base = config.baseBranch ?? prBaseOf(ctx.codebases[alias]);
        return {
          alias,
          push: true,
          pullRequest: {
            ...(config.generateText ? { generate: true } : { title, body, generate: false }),
            ...(base ? { base } : {}),
            ...(config.draft !== undefined ? { draft: config.draft } : {}),
          },
        };
      },
      (result) => {
        const pr = result.pullRequest;
        return pr ? `PR #${pr.number} created for ${result.alias}: ${pr.url}` : `${result.alias}: no pull request was opened`;
      },
    );
  }

  // ── Preprocessing ───────────────────────────────────────────

  private async executeStep(step: PreprocessingStep, ctx: LifecycleStepContext): Promise<string | undefined> {
    const config = step.config;
    switch (config.type) {
      case 'clone_repo':
        return this.executeCloneRepo(config, ctx);
      case 'run_script':
        return this.runScript(config, ctx, 'Script');
      case 'validate_input':
        return this.executeValidateInput(config, ctx);
      case 'set_variable':
        return this.executeSetVariable(config, ctx);
      case 'conditional':
        return this.executeConditional(config, ctx);
      default:
        throw new Error(`Unknown preprocessing step type: ${(config as { type: string }).type}`);
    }
  }

  private async executeCloneRepo(config: CloneRepoStepConfig, ctx: LifecycleStepContext): Promise<string> {
    // A checkout the run already has for this alias (a mounted codebase)
    // is what the step exists to produce.
    const existing = ctx.codebases[config.repoAlias]?.path;
    if (existing) return existing;
    const repo = repositoryFromInputs(config.repoAlias, ctx.variables);
    if (!repo) {
      throw new Error(`No repository to clone for "${config.repoAlias}". Enter a repository URL or run the workflow in a project.`);
    }
    if (!isAllowedCloneUrl(repo.url)) {
      throw new Error(`Only https and ssh repositories can be cloned (got "${repo.url}")`);
    }
    const targetDir = path.join(ctx.workDir, repo.alias);
    const clonedPath = await this.gitManager.cloneToDirectory(repo.url, targetDir, repo.branch);
    ctx.codebases[repo.alias] = { path: clonedPath, branch: repo.branch ?? null, baseRef: repo.branch ?? null };
    return clonedPath;
  }

  private async runScript(
    config: Pick<RunScriptStepConfig, 'script' | 'cwd' | 'timeoutMs'>,
    ctx: LifecycleStepContext,
    label: string,
  ): Promise<string> {
    // The script is a literal (templates are rejected at save time);
    // variables reach it only as GEN_VAR_* env values.
    const cwd = config.cwd ? path.resolve(ctx.workDir, config.cwd) : ctx.workDir;
    const shell = scriptShell(config.script, this.platform);
    const result = await this.scriptRunner.run(shell.command, shell.args, {
      cwd,
      timeout: config.timeoutMs ?? 60_000,
      env: buildGenVarEnv(ctx.variables),
    });
    if (result.exitCode !== 0) throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr}`);
    return result.stdout;
  }

  private async executeValidateInput(config: ValidateInputStepConfig, ctx: LifecycleStepContext): Promise<string> {
    const value = ctx.variables[config.variableName];
    for (const rule of config.rules) {
      switch (rule.type) {
        case 'required':
          if (value === undefined || value === null || value === '') throw new Error(rule.message);
          break;
        case 'regex': {
          // Linear-time engine: a pathological pattern cannot stall the event loop (RV-21).
          const compiled = compileSafeRegex(rule.pattern, rule.flags ?? '');
          if (!compiled.ok) throw new Error(`Invalid pattern for ${config.variableName}: ${compiled.error.message}`);
          if (!compiled.regex.test(String(value))) throw new Error(rule.message);
          break;
        }
        case 'min_length':
          if (String(value ?? '').length < rule.value) throw new Error(rule.message);
          break;
        case 'max_length':
          if (String(value ?? '').length > rule.value) throw new Error(rule.message);
          break;
      }
    }
    return `Validation passed for ${config.variableName}`;
  }

  private async executeSetVariable(config: SetVariableStepConfig, ctx: LifecycleStepContext): Promise<string> {
    if (!/^[a-zA-Z_]\w*$/.test(config.variableName)) {
      throw new Error(`Invalid variable name: '${config.variableName}'. Must start with a letter or underscore and contain only word characters.`);
    }
    if (config.variableName.startsWith('__')) throw new Error(`Variable name '${config.variableName}' uses reserved '__' prefix.`);
    const resolvedValue = this.render(config.value, ctx);
    ctx.variables[config.variableName] = resolvedValue;
    return `Set ${config.variableName} = ${resolvedValue}`;
  }

  private async executeConditional(config: ConditionalStepConfig, ctx: LifecycleStepContext): Promise<string> {
    // A condition that does not parse fails the step instead of silently taking the else branch.
    const result = evaluateSource(config.condition, { variables: ctx.variables });
    if (!result.ok) throw new Error(`Invalid condition "${config.condition}": ${result.error.message}`);
    if (result.value === true) {
      const results = await this.execute(config.thenSteps, ctx);
      return `Condition true: executed ${results.length} then-steps`;
    }
    if (config.elseSteps && config.elseSteps.length > 0) {
      const results = await this.execute(config.elseSteps, ctx);
      return `Condition false: executed ${results.length} else-steps`;
    }
    return 'Condition false: no else-steps';
  }
}
