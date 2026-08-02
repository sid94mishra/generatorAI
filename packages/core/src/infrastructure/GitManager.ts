// ────────────────────────────────────────────────────────────────
// GitManager — backward-compatible façade over @generatorai/git GitClient
// ────────────────────────────────────────────────────────────────
//
// Local git operations now live in the standalone, fully-tested
// @generatorai/git package (`GitClient`). GitManager remains as a thin
// subclass so existing composition-root / SDK wiring keeps working, and it
// retains `createPullRequest` (gh CLI) purely for backward compatibility —
// new code should go through @generatorai/source-control instead.

import { GitClient } from '@generatorai/git';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { ILogger } from '@generatorai/shared';
import { GitError } from '@generatorai/shared';

export interface GitManagerOptions {
  workspacesDir: string;
  defaultTimeoutMs?: number;
}

export interface PullRequestResult {
  url: string;
  number: number;
  title: string;
}

export class GitManager extends GitClient {
  private readonly prRunner: IScriptRunner;
  private readonly gmLogger: ILogger;

  constructor(scriptRunner: IScriptRunner, logger: ILogger, options: GitManagerOptions) {
    super(scriptRunner, logger, options);
    this.prRunner = scriptRunner;
    this.gmLogger = logger;
  }

  /**
   * @deprecated Prefer @generatorai/source-control's provider instead.
   * Create a pull request using the GitHub CLI (`gh`).
   */
  async createPullRequest(
    repoDir: string,
    title: string,
    body: string,
    baseBranch?: string,
  ): Promise<PullRequestResult> {
    const args = ['pr', 'create', '--title', title, '--body', body];
    if (baseBranch) args.push('--base', baseBranch);

    const result = await this.prRunner.run('gh', args, {
      cwd: repoDir,
      timeout: 120_000,
    });

    if (result.exitCode !== 0) {
      throw new GitError(`Failed to create PR: ${result.stderr}`);
    }

    const prUrl = result.stdout.trim();
    const match = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = match?.[1] ? parseInt(match[1], 10) : 0;

    this.gmLogger.info(`[Git] Created PR #${prNumber}: ${prUrl}`);

    return { url: prUrl, number: prNumber, title };
  }
}
