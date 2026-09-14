// ────────────────────────────────────────────────────────────────
// SourceControlFlowService — branch → commit → sync → push → PR (doc §4)
// ────────────────────────────────────────────────────────────────
//
// Every step here is a deterministic git/API operation the server runs
// itself. A model is used only through `ScmTextGenerator`, and only to write
// text. The flow never pushes to the default branch, never force-pushes and
// never rewrites history: when the work is on the default branch it cuts
// `generatorai/<slug>-<hex>` first, and "sync" is a merge, never a rebase.
//
// Conflicts are reported, never guessed at: the dry-run probe leaves the
// working tree untouched, and the caller decides between resolving manually,
// asking the agent, or aborting.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type {
  ILogger,
  ScmConflictReport,
  ScmFlowRequest,
  ScmFlowResult,
  ScmFlowStep,
  ScmFlowStepId,
  ScmGenerateRequest,
  ScmGenerateResult,
  PullRequestSummary,
  RepoReadiness,
  SourceControlSettings,
} from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { parseRepoSlug, type SourceControlRegistry } from '@generatorai/source-control';
import type { RepoReadinessService } from './RepoReadinessService.js';
import { notConnectedReason, REASON_NOTHING_TO_COMMIT } from './RepoReadinessService.js';
import type { ScmTextGenerator } from './ScmTextGenerator.js';
import {
  capDiffExcerpt,
  heuristicCommitMessage,
  heuristicPullRequestText,
} from './ScmTextGenerator.js';
import { redactTokens } from './redact.js';

export { redactTokens };

export interface SourceControlFlowDeps {
  git: IGitClient;
  registry: SourceControlRegistry;
  readiness: RepoReadinessService;
  text: ScmTextGenerator;
  logger: ILogger;
  settings: () => SourceControlSettings;
}

const REMOTE = 'origin';

/** Candidate PR-template locations, most specific first. */
const PR_TEMPLATE_PATHS = [
  path.join('.github', 'PULL_REQUEST_TEMPLATE.md'),
  path.join('.github', 'pull_request_template.md'),
  'PULL_REQUEST_TEMPLATE.md',
];

const CONFLICT_MARKER = /^<{7}[ \t]|^={7}$|^>{7}[ \t]/m;

/** `Fix the flaky login test` → `fix-the-flaky-login-test`. */
export function slugifyBranchHint(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug || 'work';
}

function shortHex(): string {
  return randomBytes(3).toString('hex');
}

function messageOf(err: unknown): string {
  return redactTokens(err instanceof Error ? err.message : String(err));
}

export class SourceControlFlowService {
  constructor(private readonly deps: SourceControlFlowDeps) {}

  // ────────────────────────────────────────────────────────────
  // The flow
  // ────────────────────────────────────────────────────────────

  async run(input: {
    workspaceId?: string;
    repoDir: string;
    alias: string;
    request: ScmFlowRequest;
    context?: { chatName?: string; hint?: string };
  }): Promise<ScmFlowResult> {
    const { repoDir, alias, request, context } = input;
    const git = this.deps.git;
    const steps: ScmFlowStep[] = [];

    const readiness = await this.deps.readiness.readiness({ repoDir, alias });

    const wantCommit = Boolean(request.commit);
    const wantPr = Boolean(request.pullRequest);
    const wantPush = request.push === true || wantPr;

    // 1 ── readiness
    const blockedReason = blockingReason(readiness, {
      commit: wantCommit,
      push: request.push === true,
      pullRequest: wantPr,
    });
    if (blockedReason) {
      return {
        status: 'blocked',
        alias,
        steps: [{ id: 'readiness', status: 'blocked', detail: blockedReason }],
        readiness,
      };
    }
    steps.push({ id: 'readiness', status: 'done' });

    const hint = request.hint ?? context?.hint ?? context?.chatName;
    const base =
      request.pullRequest?.base ??
      readiness.defaultBranch ??
      this.deps.settings().defaultBase ??
      null;

    const partial: {
      branch?: string;
      commit?: { sha: string; message: string };
      pushed?: boolean;
      pullRequest?: PullRequestSummary;
    } = {};

    let stepId: ScmFlowStepId = 'branch';
    try {
      // 2 ── branch
      let branch = readiness.branch;
      const branchRequested =
        wantPush && request.branch?.createIfOnDefault !== false &&
        (readiness.onDefaultBranch || readiness.branch === null);
      if (branchRequested) {
        const name =
          request.branch?.name ??
          `generatorai/${slugifyBranchHint(hint ?? 'work')}-${shortHex()}`;
        await git.createBranch(repoDir, name);
        await git.checkoutBranch(repoDir, name);
        branch = name;
        partial.branch = name;
        steps.push({ id: 'branch', status: 'done', detail: `Created ${name}` });
      } else {
        steps.push({
          id: 'branch',
          status: 'skipped',
          detail: !wantPush
            ? 'Not pushing or opening a pull request'
            : request.branch?.createIfOnDefault === false
              ? 'Branch creation is disabled for this run'
              : `Already on ${branch ?? 'a work branch'}`,
        });
      }

      // 3 ── commit
      stepId = 'commit';
      if (request.commit) {
        const changed = await git.changedFilesSummary(repoDir);
        if (changed.length === 0) {
          steps.push({ id: 'commit', status: 'skipped', detail: REASON_NOTHING_TO_COMMIT });
        } else {
          const files = changed.map((c) => c.path);
          let message = request.commit.message?.trim();
          if (!message) {
            if (request.commit.generate !== false) {
              const generated = await this.deps.text.generateCommitMessage({
                repoDir,
                ...(hint ? { hint } : {}),
                files,
                diffExcerpt: capDiffExcerpt(await this.workingDiff(repoDir)),
              });
              message = generated.message;
            } else {
              message = heuristicCommitMessage(files, hint);
            }
          }
          const commit = await git.commitWithSha(repoDir, message);
          if (commit) {
            partial.commit = { sha: commit.sha, message: commit.message };
            steps.push({
              id: 'commit',
              status: 'done',
              detail: `${commit.sha.slice(0, 8)} — ${firstLine(commit.message)}`,
            });
          } else {
            steps.push({ id: 'commit', status: 'skipped', detail: REASON_NOTHING_TO_COMMIT });
          }
        }
      } else {
        steps.push({ id: 'commit', status: 'skipped', detail: 'Not requested' });
      }

      const branchNow = (await git.currentBranch(repoDir)) ?? branch;

      // 4 ── sync
      stepId = 'sync';
      if (wantPush && request.sync !== false && readiness.hasRemote) {
        if (!base) {
          steps.push({ id: 'sync', status: 'skipped', detail: 'No base branch could be resolved' });
        } else if (base === branchNow) {
          steps.push({ id: 'sync', status: 'skipped', detail: `Already on ${base}` });
        } else {
          const conflicts = await this.syncWithBase(repoDir, base, branchNow ?? 'HEAD');
          if (conflicts) {
            return {
              status: 'conflicts',
              alias,
              steps: [
                ...steps,
                {
                  id: 'sync',
                  status: 'failed',
                  detail: `Merge conflicts with ${REMOTE}/${base}`,
                },
              ],
              conflicts,
              readiness: await this.refreshReadiness(repoDir, alias, readiness),
              ...partial,
            };
          }
          steps.push({ id: 'sync', status: 'done', detail: `Merged ${REMOTE}/${base}` });
        }
      } else {
        steps.push({
          id: 'sync',
          status: 'skipped',
          detail: !readiness.hasRemote
            ? 'No git remote'
            : request.sync === false
              ? 'Sync disabled for this run'
              : 'Not pushing or opening a pull request',
        });
      }

      // 5 ── push
      stepId = 'push';
      if (wantPush) {
        if (!branchNow) throw new Error('Cannot push from a detached HEAD');
        await git.pushSetUpstream(repoDir, REMOTE, branchNow);
        partial.pushed = true;
        steps.push({ id: 'push', status: 'done', detail: `${REMOTE}/${branchNow}` });
      } else {
        steps.push({ id: 'push', status: 'skipped', detail: 'Not requested' });
      }

      // 6 ── pull_request
      stepId = 'pull_request';
      if (wantPr) {
        const pr = await this.openPullRequest({
          repoDir,
          readiness,
          head: branchNow ?? '',
          base,
          request,
          hint,
          steps,
        });
        partial.pullRequest = pr;
      } else {
        steps.push({ id: 'pull_request', status: 'skipped', detail: 'Not requested' });
      }

      return { status: 'ok', alias, steps, readiness: await this.refreshReadiness(repoDir, alias, readiness), ...partial };
    } catch (err) {
      const detail = messageOf(err);
      this.deps.logger.warn(`[SCM] Flow failed at ${stepId}: ${detail}`);
      return {
        status: 'failed',
        alias,
        error: detail,
        steps: [...steps, { id: stepId, status: 'failed', detail }],
        readiness: await this.refreshReadiness(repoDir, alias, readiness),
        ...partial,
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // Generate-only (the UI's "Generate" buttons)
  // ────────────────────────────────────────────────────────────

  async generate(input: {
    repoDir: string;
    alias: string;
    request: ScmGenerateRequest;
    context?: { chatName?: string };
  }): Promise<ScmGenerateResult> {
    const { repoDir, request } = input;
    const git = this.deps.git;
    const hint = request.hint ?? input.context?.chatName;

    if (request.kind === 'commit') {
      const changed = await git.changedFilesSummary(repoDir);
      const result = await this.deps.text.generateCommitMessage({
        repoDir,
        ...(hint ? { hint } : {}),
        files: changed.map((c) => c.path),
        diffExcerpt: capDiffExcerpt(await this.workingDiff(repoDir)),
      });
      return {
        kind: 'commit',
        message: result.message,
        ...(result.model ? { model: result.model } : {}),
        source: result.source,
      };
    }

    const base =
      request.base ??
      (await safe(() => git.defaultBranch(repoDir), null)) ??
      this.deps.settings().defaultBase ??
      'main';
    const { commits, files, diffExcerpt } = await this.branchContext(repoDir, base);
    const template = await readPullRequestTemplate(repoDir);
    const result = await this.deps.text.generatePullRequestText({
      repoDir,
      base,
      ...(hint ? { hint } : {}),
      commits,
      files,
      diffExcerpt,
      ...(template ? { template } : {}),
    });
    return {
      kind: 'pull_request',
      title: result.title,
      body: result.body,
      ...(result.model ? { model: result.model } : {}),
      source: result.source,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Conflicts
  // ────────────────────────────────────────────────────────────

  /** Apply the merge to the working tree so the user (or the agent) can edit it. */
  async startConflictMerge(input: {
    repoDir: string;
    alias: string;
    base?: string;
  }): Promise<ScmConflictReport> {
    const { repoDir } = input;
    const git = this.deps.git;
    const head = (await git.currentBranch(repoDir)) ?? 'HEAD';
    const base = await this.resolveBase(repoDir, input.base);

    if (await git.mergeInProgress(repoDir)) {
      return { base, head, files: await git.unmergedFiles(repoDir), mergeStarted: true };
    }

    await git.fetch(repoDir, REMOTE, base);
    await git.merge(repoDir, `${REMOTE}/${base}`, { noCommit: true });
    const files = await git.unmergedFiles(repoDir);
    if (files.length === 0) {
      // Nothing conflicted after all (the base moved but merged cleanly, or
      // the branch was already in sync). Don't leave a half-open merge behind
      // for the user or the agent to "resolve".
      if (await git.mergeInProgress(repoDir)) {
        await git.commitMerge(repoDir, `Merge ${REMOTE}/${base} into ${head}`);
      }
      return { base, head, files: [], mergeStarted: false };
    }
    return { base, head, files, mergeStarted: true };
  }

  /** Verify nothing is still conflicted, then commit the merge. */
  async continueAfterConflicts(input: {
    repoDir: string;
    alias: string;
    message?: string;
  }): Promise<{ ok: boolean; sha?: string; remaining: string[] }> {
    const { repoDir } = input;
    const git = this.deps.git;

    const remaining = await git.unmergedFiles(repoDir);
    if (remaining.length > 0) {
      // A path is still unmerged in the INDEX. That is expected right after a
      // manual edit — the UI has no "stage" concept — so the real question is
      // whether the working-tree copy still carries conflict markers.
      const unresolved = await filesWithConflictMarkers(repoDir, remaining);
      if (unresolved.length > 0) return { ok: false, remaining: unresolved };
      await git.addAll(repoDir);
    }

    const head = (await git.currentBranch(repoDir)) ?? 'HEAD';
    const base = await this.resolveBase(repoDir, undefined);
    const sha = await git.commitMerge(
      repoDir,
      input.message ?? `Merge ${REMOTE}/${base} into ${head}`,
    );
    return { ok: true, sha, remaining: [] };
  }

  async abortConflicts(input: { repoDir: string; alias: string }): Promise<void> {
    await this.deps.git.mergeAbort(input.repoDir);
  }

  /** The chat turn that asks the agent to resolve a conflicted merge (doc §4). */
  buildAgentConflictPrompt(report: ScmConflictReport): string {
    const files = report.files.length > 0
      ? report.files.map((f) => `- \`${f}\``).join('\n')
      : '- (git reported no unmerged paths)';
    return [
      `A merge of \`${REMOTE}/${report.base}\` into \`${report.head}\` left conflicts in the working tree. Resolve them.`,
      '',
      'Conflicted files:',
      files,
      '',
      'Rules — follow all of them:',
      '',
      `1. Keep the intent of BOTH sides. \`${report.head}\` is our work; \`${REMOTE}/${report.base}\` is the incoming base branch. Neither side may silently lose a change.`,
      '2. Edit ONLY the files listed above. Do not touch unrelated files, do not reformat, do not "tidy up" while you are in there.',
      '3. Remove every conflict marker — `<<<<<<<`, `=======`, `>>>>>>>`. Leaving one behind breaks the build.',
      '4. Do NOT run `git commit`, `git merge --continue`, `git push` or `git rebase`. The platform commits the merge after the user reviews it; running git yourself takes that review away.',
      '5. When a choice is genuinely ambiguous, prefer the incoming base-branch change — and say so explicitly in your report.',
      '',
      'When you are done, finish with a short report: one line per file saying which side you kept and why, and call out anything you were unsure about so the user can check it.',
    ].join('\n');
  }

  // ────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────

  /**
   * Merge `origin/<base>` into the current branch. Returns a conflict report
   * when the merge cannot be done cleanly (working tree untouched), else null.
   */
  /** Readiness after the flow touched the repo (branch, commits, upstream); falls back to the pre-flow snapshot. */
  private async refreshReadiness(repoDir: string, alias: string, previous: RepoReadiness): Promise<RepoReadiness> {
    try {
      return await this.deps.readiness.readiness({ repoDir, alias });
    } catch {
      return previous;
    }
  }

  private async syncWithBase(
    repoDir: string,
    base: string,
    head: string,
  ): Promise<ScmConflictReport | null> {
    const git = this.deps.git;
    const ref = `${REMOTE}/${base}`;
    await git.fetch(repoDir, REMOTE, base);

    // Preferred: ask git without touching the working tree (git >= 2.38).
    const probe = await git.mergeTreeConflicts(repoDir, 'HEAD', ref);
    if (probe.supported && probe.conflicts.length > 0) {
      return { base, head, files: probe.conflicts, mergeStarted: false };
    }

    if (!probe.supported) {
      // Older git: a real `--no-commit` merge, immediately undone either way,
      // so the caller still sees an untouched tree.
      const dryRun = await git.merge(repoDir, ref, { noCommit: true });
      await git.mergeAbort(repoDir);
      if (!dryRun.ok) {
        return { base, head, files: dryRun.conflicts, mergeStarted: false };
      }
    }

    const merged = await git.merge(repoDir, ref, { message: `Merge ${ref} into ${head}` });
    if (!merged.ok) {
      // Raced with a push to the base between the probe and the merge.
      return { base, head, files: merged.conflicts, mergeStarted: true };
    }
    return null;
  }

  private async openPullRequest(args: {
    repoDir: string;
    readiness: RepoReadiness;
    head: string;
    base: string | null;
    request: ScmFlowRequest;
    hint: string | undefined;
    steps: ScmFlowStep[];
  }): Promise<PullRequestSummary> {
    const { repoDir, readiness, head, request, hint, steps } = args;
    const git = this.deps.git;

    const remoteUrl = readiness.remoteUrl ?? (await git.getRemoteUrl(repoDir));
    const slug = remoteUrl ? parseRepoSlug(remoteUrl) : null;
    if (!slug) throw new Error(`Could not parse a repo slug from the remote of ${repoDir}`);

    const provider = this.deps.registry.providerFor(slug.host);
    if (!provider) throw new Error(notConnectedReason(slug.host));
    if (!head) throw new Error('Cannot open a pull request from a detached HEAD');

    const existing = await provider.findOpenPullRequestForHead(
      slug.owner,
      slug.repo,
      head,
      slug.host,
    );
    if (existing) {
      steps.push({
        id: 'pull_request',
        status: 'done',
        detail: `Reused existing PR #${existing.number}`,
      });
      return existing;
    }

    const base = args.base ?? (await this.resolveBase(repoDir, undefined));
    let title = request.pullRequest?.title?.trim();
    let body = request.pullRequest?.body;

    if (!title || body === undefined) {
      const { commits, files, diffExcerpt } = await this.branchContext(repoDir, base);
      if (request.pullRequest?.generate !== false) {
        const template = await readPullRequestTemplate(repoDir);
        const generated = await this.deps.text.generatePullRequestText({
          repoDir,
          base,
          ...(hint ? { hint } : {}),
          commits,
          files,
          diffExcerpt,
          ...(template ? { template } : {}),
        });
        title = title || generated.title;
        body = body ?? generated.body;
      } else {
        const fallback = heuristicPullRequestText(files, commits, hint, await readPullRequestTemplate(repoDir));
        title = title || fallback.title;
        body = body ?? fallback.body;
      }
    }

    const pr = await provider.createPullRequest({
      owner: slug.owner,
      repo: slug.repo,
      host: slug.host,
      head,
      base,
      title: title || `Changes from ${head}`,
      ...(body !== undefined ? { body } : {}),
      ...(request.pullRequest?.draft !== undefined ? { draft: request.pullRequest.draft } : {}),
      repoDir,
    });
    steps.push({ id: 'pull_request', status: 'done', detail: `Opened PR #${pr.number}` });
    return pr;
  }

  /** Commit subjects, changed paths and a capped diff for `origin/<base>..HEAD`. */
  private async branchContext(
    repoDir: string,
    base: string,
  ): Promise<{ commits: string[]; files: string[]; diffExcerpt: string }> {
    const git = this.deps.git;
    const ref = `${REMOTE}/${base}`;
    const commits = await safe(() => git.log(repoDir, `${ref}..HEAD`, 20), []);
    let files = (await safe(() => git.diffNameStatusZ(repoDir, ref, 'HEAD'), [])).map((e) => e.path);
    if (files.length === 0) {
      files = (await safe(() => git.changedFilesSummary(repoDir), [])).map((e) => e.path);
    }
    let diff = await safe(() => git.diffPatch(repoDir, ref, 'HEAD'), '');
    if (!diff) diff = await this.workingDiff(repoDir);
    return { commits, files, diffExcerpt: capDiffExcerpt(diff) };
  }

  /** Unstaged + staged working-tree diff, for commit-message generation. */
  private async workingDiff(repoDir: string): Promise<string> {
    const git = this.deps.git;
    const unstaged = await safe(() => git.getDiff(repoDir, false), '');
    const staged = await safe(() => git.getDiff(repoDir, true), '');
    if (unstaged && staged) return `${unstaged}\n${staged}`;
    return unstaged || staged;
  }

  private async resolveBase(repoDir: string, explicit: string | undefined): Promise<string> {
    if (explicit) return explicit;
    const fromGit = await safe(() => this.deps.git.defaultBranch(repoDir), null);
    return fromGit ?? this.deps.settings().defaultBase ?? 'main';
  }
}

// ────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────

/**
 * The reason a REQUESTED capability cannot run, or null. "Nothing to commit"
 * is a skip, not a block — the rest of the flow (sync/push/PR) is still valid.
 */
function blockingReason(
  readiness: RepoReadiness,
  want: { commit: boolean; push: boolean; pullRequest: boolean },
): string | null {
  if (want.commit && !readiness.can.commit) {
    const reason = readiness.reasons.commit;
    if (reason && reason !== REASON_NOTHING_TO_COMMIT) return reason;
  }
  if (want.push && !readiness.can.push) {
    return readiness.reasons.push ?? 'Cannot push';
  }
  if (want.pullRequest && !readiness.can.pullRequest) {
    return readiness.reasons.pullRequest ?? 'Cannot open a pull request';
  }
  return null;
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** The repo's PR template, when it has one. */
export async function readPullRequestTemplate(repoDir: string): Promise<string | undefined> {
  for (const rel of PR_TEMPLATE_PATHS) {
    try {
      const content = await fs.readFile(path.join(repoDir, rel), 'utf-8');
      if (content.trim()) return content;
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

/** Of `files`, the ones whose working-tree copy still carries conflict markers. */
async function filesWithConflictMarkers(repoDir: string, files: string[]): Promise<string[]> {
  const unresolved: string[] = [];
  for (const rel of files) {
    try {
      const content = await fs.readFile(path.join(repoDir, rel), 'utf-8');
      if (CONFLICT_MARKER.test(content)) unresolved.push(rel);
    } catch {
      // Deleted on one side, or binary — git still knows it is unmerged.
      unresolved.push(rel);
    }
  }
  return unresolved;
}
