// ────────────────────────────────────────────────────────────────
// The source-control flow, as data.
//
// Everything the commit bar, the flow sheet, the conflict sheet and the
// transcript row decide is computed here: which mount to act on, what the
// status line says, why an action is unavailable, which steps a request will
// run, and how a result reads. Pure — no React, no fetch — because these are
// the rules worth testing, and a phone screen is not a place to test them.
//
// One mobile-specific rule lives here: the server's "not connected" reason
// ends in "connect it in Settings → Source Control", which on a phone points
// at a screen that deliberately cannot connect anything. `actionReason`
// rewrites exactly that case and leaves every other reason verbatim.
// ────────────────────────────────────────────────────────────────

import type {
  RepoReadiness,
  ScmFlowRequest,
  ScmFlowResult,
  ScmFlowStep,
  ScmFlowStepId,
} from '@generatorai/shared';

export type ScmAction = 'commit' | 'push' | 'pullRequest';

/** What a phone can honestly tell someone whose host is not connected. */
export const CONNECT_ON_DESKTOP = 'Connect it in Settings › Source control.';

/** Toast/badge variants shared with the UI kit. */
export type ScmTone = 'info' | 'success' | 'warning' | 'danger';

export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

/**
 * Why `action` is unavailable, in the words a phone should use.
 *
 * `null` means it is available. A missing reason on an unavailable action is
 * still reported ("Unavailable") rather than silently swallowed — a dead
 * button with no explanation is the failure mode principle 4 exists to stop.
 */
export function actionReason(readiness: RepoReadiness, action: ScmAction): string | null {
  if (readiness.can[action]) return null;
  const reason = readiness.reasons[action];
  if (reason) return mobileReason(reason, readiness);
  // No reason came back, but the host being unconnected explains it.
  if (!readiness.connected && readiness.hasRemote && action !== 'commit') {
    const host = readiness.slug?.host;
    return `${host ? `${host} is` : "This remote's host is"} not connected. ${CONNECT_ON_DESKTOP}`;
  }
  return 'Unavailable';
}

/** `main · ↑2 ↓1 · 3 files` — the one-line state of a mount. */
export function readinessLine(readiness: RepoReadiness): string {
  if (!readiness.isRepo) return 'Not a git repository';
  const parts: string[] = [];
  if (readiness.detached) parts.push('detached HEAD');
  else parts.push(readiness.branch ?? 'no branch');
  const counts: string[] = [];
  if (readiness.ahead) counts.push(`↑${readiness.ahead}`);
  if (readiness.behind) counts.push(`↓${readiness.behind}`);
  if (counts.length > 0) parts.push(counts.join(' '));
  else if (readiness.hasUpstream && readiness.ahead === 0 && readiness.behind === 0) parts.push('in sync');
  if (readiness.changedFiles > 0) {
    parts.push(`${readiness.changedFiles} ${readiness.changedFiles === 1 ? 'file' : 'files'}`);
  }
  if (readiness.mergeInProgress) parts.push('merge in progress');
  return parts.join(' · ');
}

/** Mount the bar acts on: the requested alias, else the first that can commit, else the first. */
export function pickRepo(
  repos: readonly RepoReadiness[],
  alias?: string | null,
): RepoReadiness | null {
  if (repos.length === 0) return null;
  if (alias) {
    const named = repos.find((r) => r.alias === alias);
    if (named) return named;
  }
  return repos.find((r) => r.can.commit) ?? repos.find((r) => r.isRepo) ?? repos[0] ?? null;
}

/** True when there is any SCM action at all to offer for this mount. */
export function hasAnyAction(readiness: RepoReadiness): boolean {
  return readiness.can.commit || readiness.can.push || readiness.can.pullRequest;
}

// ── The flow request ─────────────────────────────────────────────

export interface ScmFlowForm {
  alias: string;
  /** Empty means "let the server write one" (`commit.generate`). */
  message: string;
  push: boolean;
  pullRequest: boolean;
  title: string;
  body: string;
  /** Empty means the repo default. */
  base: string;
  draft: boolean;
  /** Seeds generated text — the chat's name or task description. */
  hint?: string;
}

/**
 * `canPush` seeds the Push switch the way the desktop Changes tab does: on
 * whenever the mount can push, so the one button commits AND publishes unless
 * the user says otherwise. It stays off for a mount that cannot push, where an
 * "on" switch would promise a step the flow will skip.
 */
export function emptyFlowForm(alias: string, canPush = false): ScmFlowForm {
  return { alias, message: '', push: canPush, pullRequest: false, title: '', body: '', base: '', draft: false };
}

/**
 * Build the flow body.
 *
 * A pull request implies a push implies a commit — the server would do the
 * same, but sending the implication makes the request say what the user
 * asked for rather than relying on the server to infer it.
 */
export function buildFlowRequest(form: ScmFlowForm): ScmFlowRequest {
  const message = form.message.trim();
  const title = form.title.trim();
  const body = form.body.trim();
  const base = form.base.trim();
  const push = form.push || form.pullRequest;

  const request: ScmFlowRequest = {
    alias: form.alias,
    commit: message ? { message } : { generate: true },
    push,
  };
  if (form.pullRequest) {
    request.pullRequest = {
      ...(title ? { title } : {}),
      ...(body ? { body } : {}),
      ...(base ? { base } : {}),
      ...(form.draft ? { draft: true } : {}),
      ...(title && body ? {} : { generate: true }),
    };
  }
  if (form.hint?.trim()) request.hint = form.hint.trim();
  return request;
}

/**
 * The request that finishes a flow after conflicts were resolved.
 *
 * No commit (the `continue` call committed the merge itself) and no sync
 * (the merge is what the sync was for) — only the steps that were still
 * pending when the conflict stopped the run.
 */
export function resumeAfterConflictsRequest(form: ScmFlowForm): ScmFlowRequest {
  const request = buildFlowRequest(form);
  delete request.commit;
  request.sync = false;
  return request;
}

/** What the primary button in the flow sheet promises to do. */
export function runLabel(form: Pick<ScmFlowForm, 'push' | 'pullRequest'>): string {
  if (form.pullRequest) return 'Commit, push & open PR';
  if (form.push) return 'Commit & push';
  return 'Commit';
}

const STEP_LABELS: Record<ScmFlowStepId, string> = {
  readiness: 'Check the repository',
  branch: 'Create a work branch',
  commit: 'Commit',
  sync: 'Sync with the base branch',
  push: 'Push',
  pull_request: 'Open the pull request',
};

export function stepLabel(id: ScmFlowStepId): string {
  return STEP_LABELS[id] ?? id;
}

/** The steps a request is expected to run, in order — the progress checklist. */
export function plannedSteps(request: ScmFlowRequest): ScmFlowStepId[] {
  const steps: ScmFlowStepId[] = ['readiness'];
  const wantsRemote = Boolean(request.push) || Boolean(request.pullRequest);
  if (wantsRemote && request.branch?.createIfOnDefault !== false) steps.push('branch');
  if (request.commit) steps.push('commit');
  if (wantsRemote && request.sync !== false) steps.push('sync');
  if (request.push) steps.push('push');
  if (request.pullRequest) steps.push('pull_request');
  return steps;
}

export function stepTone(status: ScmFlowStep['status']): ScmTone {
  switch (status) {
    case 'done':
      return 'success';
    case 'failed':
      return 'danger';
    case 'blocked':
      return 'warning';
    default:
      return 'info';
  }
}

// ── Results ──────────────────────────────────────────────────────

/** `Committed abc1234 · pushed · PR #12` — the transcript row and the toast. */
export function summarizeFlow(result: ScmFlowResult): string {
  const parts: string[] = [];
  if (result.commit?.sha) parts.push(`Committed ${shortSha(result.commit.sha)}`);
  if (result.pushed) parts.push('pushed');
  if (result.pullRequest) parts.push(`PR #${result.pullRequest.number}`);
  if (parts.length === 0) return 'Nothing to commit';
  return parts.join(' · ');
}

/** First reason a blocked/failed run gives, whichever layer produced it. */
export function blockedReason(result: ScmFlowResult): string {
  if (result.error) return result.error;
  const failed = result.steps.find((s) => s.status === 'blocked' || s.status === 'failed');
  if (failed?.detail) return failed.detail;
  const readiness = result.readiness;
  const reasons = [readiness.reasons.commit, readiness.reasons.push, readiness.reasons.pullRequest];
  return reasons.find(Boolean) ?? 'The flow could not run.';
}

export interface FlowOutcome {
  message: string;
  tone: ScmTone;
  /** The PR to offer an "Open PR" action for. */
  url?: string;
  prNumber?: number;
  conflicts: boolean;
}

export function describeFlowResult(result: ScmFlowResult): FlowOutcome {
  if (result.status === 'conflicts') {
    const files = result.conflicts?.files.length ?? 0;
    return {
      message: `Merge conflicts in ${files} ${files === 1 ? 'file' : 'files'}`,
      tone: 'warning',
      conflicts: true,
    };
  }
  if (result.status === 'blocked') {
    return { message: mobileReason(blockedReason(result), result.readiness), tone: 'warning', conflicts: false };
  }
  if (result.status === 'failed') {
    return { message: mobileReason(blockedReason(result), result.readiness), tone: 'danger', conflicts: false };
  }
  return {
    message: summarizeFlow(result),
    tone: 'success',
    ...(result.pullRequest ? { url: result.pullRequest.url, prNumber: result.pullRequest.number } : {}),
    conflicts: false,
  };
}

/** Same rewrite `actionReason` performs, for a reason that arrives on a result. */
export function mobileReason(reason: string, readiness?: RepoReadiness): string {
  if (/Settings\s*(→|->|›)\s*Source Control/i.test(reason)) {
    const trimmed = reason
      .replace(/—?\s*connect it in Settings\s*(→|->|›)\s*Source Control\.?/i, '')
      .trim();
    return `${trimmed} ${CONNECT_ON_DESKTOP}`.trim();
  }
  if (readiness && !readiness.connected && /not connected/i.test(reason)) {
    return `${reason.replace(/\.$/, '')}. ${CONNECT_ON_DESKTOP}`;
  }
  return reason;
}
