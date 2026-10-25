// ────────────────────────────────────────────────────────────────
// Pure source-control rules shared by the ship dialog's hook and its view.
//
// Everything is decided from `GET /scm/readiness` (`RepoReadiness.can` /
// `.reasons`): the server is the judge of what a mount can do, one
// capability at a time, and the request never asks for what it cannot.
// ────────────────────────────────────────────────────────────────

import type { RepoReadiness, ScmFlowRequest, ScmFlowResult, ScmFlowStep } from '@generatorai/shared';

export const SCM_STEP_LABEL: Record<ScmFlowStep['id'], string> = {
  readiness: 'Checks',
  branch: 'Branch',
  commit: 'Commit',
  sync: 'Sync with base',
  push: 'Push',
  pull_request: 'Pull request',
};

/** Where "Connect GitHub" sends the user. */
export const SCM_SETTINGS_PATH = '/settings/source-control';

/** Which repo the panel opens on: the first with changes, else the first. */
export function pickDefaultAlias(repos: RepoReadiness[]): string | undefined {
  return (repos.find((r) => r.dirty) ?? repos[0])?.alias;
}

/** What the selected mount can do, and why not when it cannot. */
export interface ScmAvailability {
  /**
   * Set when NOTHING here can work. A missing remote or account costs only the
   * toggle it affects: committing has nothing to do with a forge account.
   */
  blockedReason: string | null;
  /** "Connect GitHub" helps only when the remote is a hosted forge. */
  needsConnect: boolean;
  canPush: boolean;
  canOpenPr: boolean;
  /**
   * A merge someone started (Resolve manually / Ask the agent, or a git merge
   * outside the app) must be finished or abandoned first — the commit form
   * would only be refused by the server.
   */
  mergeInProgress: boolean;
}

export function scmAvailability(selected: RepoReadiness | undefined, result: ScmFlowResult | null): ScmAvailability {
  const blockedReason = selected
    ? !selected.isRepo
      ? 'Not a git repository'
      : !selected.can.commit && !selected.can.push && !selected.can.pullRequest
        ? (selected.reasons.commit ?? selected.reasons.push ?? selected.reasons.pullRequest ?? 'Source control is unavailable here')
        : null
    : null;
  // A local path or a bare `host:path` remote has no account to connect.
  const remoteIsHosted = !!selected?.remoteUrl && /^(https?:\/\/|ssh:\/\/|git@)/i.test(selected.remoteUrl);
  return {
    blockedReason,
    needsConnect: !!selected && selected.isRepo && selected.hasRemote && !selected.connected && remoteIsHosted,
    canPush: selected?.can.push ?? false,
    canOpenPr: selected?.can.pullRequest ?? false,
    mergeInProgress: !!selected && !blockedReason && selected.mergeInProgress && result?.status !== 'conflicts',
  };
}

/** What the dialog's primary action runs (D-163). */
export type ShipMode = 'commit' | 'push' | 'pr';

export interface ShipForm {
  mode: ShipMode;
  /** Commit summary (first line); blank with a blank description asks the server to write one. */
  summary: string;
  description: string;
  prTitle: string;
  prBody: string;
  base: string;
  draft: boolean;
  reviewers: readonly string[];
  assignees: readonly string[];
  labels: readonly string[];
  closesIssues: readonly number[];
}

/** `summary` + blank line + `description`, the way git and GitHub split a message. */
export function commitMessageOf(summary: string, description: string): string {
  return [summary.trim(), description.trim()].filter(Boolean).join('\n\n');
}

/** A generated message back into the two fields. */
export function splitCommitMessage(message: string): { summary: string; description: string } {
  const [first = '', ...rest] = message.split('\n');
  return { summary: first.trim(), description: rest.join('\n').trim() };
}

/**
 * The `POST /scm/flow` body. What this mount cannot do is never asked for,
 * whatever the mode — a repo with no remote must still be able to commit.
 * Blank text asks the server to write it.
 */
export function composeFlowRequest(selected: RepoReadiness | undefined, form: ShipForm, hint: string | undefined): ScmFlowRequest {
  const message = commitMessageOf(form.summary, form.description);
  const wantsPr = form.mode === 'pr' && (selected?.can.pullRequest ?? false);
  const wantsPush = (form.mode === 'push' || wantsPr) && (selected?.can.push ?? false);
  const list = (items: readonly string[]) => (items.length > 0 ? [...items] : undefined);
  const reviewers = list(form.reviewers);
  const assignees = list(form.assignees);
  const labels = list(form.labels);
  return {
    ...(selected ? { alias: selected.alias } : {}),
    commit: message ? { message } : { generate: true },
    push: wantsPush,
    ...(wantsPr
      ? {
          pullRequest: {
            ...(form.prTitle.trim() ? { title: form.prTitle.trim() } : { generate: true }),
            ...(form.prBody.trim() ? { body: form.prBody.trim() } : {}),
            ...(form.base.trim() ? { base: form.base.trim() } : {}),
            draft: form.draft,
            ...(reviewers ? { reviewers } : {}),
            ...(assignees ? { assignees } : {}),
            ...(labels ? { labels } : {}),
            ...(form.closesIssues.length > 0 ? { closesIssues: [...form.closesIssues] } : {}),
          },
        }
      : {}),
    ...(hint ? { hint } : {}),
  };
}

/** The toolbar button's verb for the repo's state, or null when there is nothing to ship (D-163). */
export interface ShipAction {
  label: string;
  mode: ShipMode;
  prominent: boolean;
  /** Nothing left to ship and a PR is open: the button opens the PR instead of the dialog. */
  href?: string;
}

export function shipActionOf(selected: RepoReadiness | undefined): ShipAction | null {
  if (!selected?.isRepo) return null;
  // Continue commits the merge; in push mode the same run then pushes it, which is what the merge was for.
  if (selected.mergeInProgress) return { label: 'Finish merge', mode: selected.can.push ? 'push' : 'commit', prominent: true };
  if (selected.dirty) return { label: 'Commit', mode: selected.can.push ? 'push' : 'commit', prominent: true };
  // Never pushed: `ahead` counts against the remote default branch. A branch still at its base has
  // nothing of ours to ship; one with its own commits (a Commit-only run, a push that failed) does.
  if (!selected.hasUpstream) {
    if ((selected.ahead ?? 0) === 0 || !selected.can.push || selected.onDefaultBranch) return null;
    return { label: 'Push', mode: selected.can.pullRequest ? 'pr' : 'push', prominent: true };
  }
  const unpushed = (selected.ahead ?? 0) > 0;
  if (selected.openPullRequest) {
    return unpushed
      ? { label: 'Push', mode: 'push', prominent: true }
      : { label: `PR #${selected.openPullRequest.number}`, mode: 'push', prominent: false, href: selected.openPullRequest.url };
  }
  if (unpushed && selected.can.push) return { label: 'Push', mode: selected.can.pullRequest ? 'pr' : 'push', prominent: true };
  if (selected.can.pullRequest && !selected.onDefaultBranch) return { label: 'Pull request', mode: 'pr', prominent: false };
  return null;
}

/** The first step that stopped the flow, if any. */
export function failingStep(result: ScmFlowResult): ScmFlowStep | undefined {
  return result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
}

function count(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** What the remote is called in sentences: GitHub, or "the remote" for any other host or a path. */
export function remoteNameOf(selected: RepoReadiness): string {
  return selected.slug?.host === 'github.com' ? 'GitHub' : 'the remote';
}

/**
 * The branch's state in plain words, GitHub-style: uncommitted files, where it stands against the
 * default branch (what a PR is about), and against its own copy on the remote (what a push does).
 */
export function branchFactsOf(selected: RepoReadiness): string[] {
  const facts: string[] = [];
  if (selected.dirty) facts.push(`${count(selected.changedFiles, 'file')} not committed`);
  if (selected.vsBase) {
    const { branch, ahead, behind } = selected.vsBase;
    if (ahead === 0 && behind === 0) facts.push(`Even with ${branch}`);
    else if (behind === 0) facts.push(`${count(ahead, 'commit')} ahead of ${branch}`);
    else if (ahead === 0) facts.push(`${count(behind, 'commit')} behind ${branch}`);
    else facts.push(`${count(ahead, 'commit')} ahead of ${branch}, ${behind} behind`);
  }
  if (selected.hasRemote && selected.branch && !selected.unborn) {
    const remote = remoteNameOf(selected);
    const ahead = selected.ahead ?? 0;
    const behind = selected.behind ?? 0;
    if (!selected.hasUpstream) facts.push(`Not on ${remote} yet`);
    else if (ahead > 0 && behind > 0) facts.push(`${count(ahead, 'commit')} to push, ${behind} new on ${remote}`);
    else if (ahead > 0) facts.push(`${count(ahead, 'commit')} not pushed`);
    else if (behind > 0) facts.push(`${count(behind, 'new commit')} on ${remote}`);
    else facts.push(`Up to date with ${remote}`);
  }
  return facts;
}
