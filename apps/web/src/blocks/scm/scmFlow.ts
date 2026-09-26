// ────────────────────────────────────────────────────────────────
// Pure source-control rules shared by the CommitBar hook and its view.
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

export interface CommitForm {
  message: string;
  push: boolean;
  openPr: boolean;
  prTitle: string;
  prBody: string;
  base: string;
  draft: boolean;
}

/**
 * The `POST /scm/flow` body. What this mount cannot do is never asked for,
 * whatever the toggles were left at — `push` defaults to on, and a repo with no
 * remote must still be able to commit. Blank text asks the server to write it.
 */
export function composeFlowRequest(
  selected: RepoReadiness | undefined,
  form: CommitForm,
  hint: string | undefined,
): ScmFlowRequest {
  const trimmed = form.message.trim();
  const wantsPr = form.openPr && (selected?.can.pullRequest ?? false);
  const wantsPush = (form.push || wantsPr) && (selected?.can.push ?? false);
  return {
    ...(selected ? { alias: selected.alias } : {}),
    commit: trimmed ? { message: trimmed } : { generate: true },
    push: wantsPush,
    ...(wantsPr
      ? {
          pullRequest: {
            ...(form.prTitle.trim() ? { title: form.prTitle.trim() } : { generate: true }),
            ...(form.prBody.trim() ? { body: form.prBody.trim() } : {}),
            ...(form.base.trim() ? { base: form.base.trim() } : {}),
            draft: form.draft,
          },
        }
      : {}),
    ...(hint ? { hint } : {}),
  };
}

/** The first step that stopped the flow, if any. */
export function failingStep(result: ScmFlowResult): ScmFlowStep | undefined {
  return result.steps.find((s) => s.status === 'failed' || s.status === 'blocked');
}
