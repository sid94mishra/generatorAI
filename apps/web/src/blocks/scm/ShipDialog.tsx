// ────────────────────────────────────────────────────────────────
// ShipDialog — the Changes toolbar's ship button and the commit / push / PR
// dialog it opens (D-163). Replaces the CommitBar footer.
//
// The button names the next step for the repo's state (Commit · Push ·
// Pull request · PR #12), from readiness; nothing to ship, no button. The
// dialog is ShipDialogView fed by useShipFlow, plus the conflict card when a
// sync collides or a merge is already in progress.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { joinPath } from '@/blocks/changes/changePaths.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { ScmConflictActions } from './ScmConflictActions.js';
import { ShipDialogView, type ShipFile } from './ShipDialogView.js';
import { pickDefaultAlias, remoteNameOf, shipActionOf, type ShipMode } from './scmFlow.js';
import { useShipFlow } from './useShipFlow.js';
import { useWorkspaceReadiness } from '@/hooks/queries.js';

export interface ShipDialogProps {
  workspaceId: string | undefined;
  /** Chat that owns this workspace, when there is one — gates "Ask the agent". */
  chatId?: string;
  /** Seeds generated commit/PR text (the chat name or the run's task). */
  hint?: string;
  /** Opens a path in the user's editor; omitted when that is unavailable. */
  onOpenFile?: (absolutePath: string) => void;
  /**
   * Changes whenever the surrounding change list does. Edits made outside the agent (the user's
   * own editor, a terminal commit) send no event, so this is what re-reads readiness for them.
   */
  changesKey?: string;
}

/** Open the dialog on one repository in one mode (a repository's own step in the Changes groups). */
export interface ShipRequest {
  alias: string;
  mode: ShipMode;
  /** A new value re-opens it, even for the same repository. */
  nonce: number;
}

/**
 * The toolbar button; renders nothing when the workspace has nothing to commit, push or propose. With
 * several repositories it names how many have a step to take; `request` opens it on one of them.
 */
export function ShipButton(props: ShipDialogProps & { request?: ShipRequest | null }) {
  const { request, ...dialogProps } = props;
  const readiness = useWorkspaceReadiness(props.workspaceId);
  const seenKey = useRef(props.changesKey);
  const { refetch } = readiness;
  useEffect(() => {
    if (seenKey.current === props.changesKey) return;
    seenKey.current = props.changesKey;
    void refetch();
  }, [props.changesKey, refetch]);
  const repos = readiness.data?.repos ?? [];
  const repo = repos.find((r) => r.alias === pickDefaultAlias(repos));
  const action = shipActionOf(repo);
  const waiting = repos.filter((r) => {
    const a = shipActionOf(r);
    return !!a && !a.href;
  }).length;
  const [open, setOpen] = useState(false);
  // The mode is fixed when the dialog opens: the button's verb changes as the flow runs
  // (Commit → PR #12), and the dialog must keep showing that run's outcome.
  const [openMode, setOpenMode] = useState<ShipMode>('commit');
  const [openAlias, setOpenAlias] = useState<string | undefined>(undefined);
  // Mounted from the first open on, so a closed dialog keeps what was typed into it.
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!request) return;
    setOpenMode(request.mode);
    setOpenAlias(request.alias);
    setOpened(true);
    setOpen(true);
  }, [request]);
  return (
    <>
      {action?.href ? (
        <Button
          size="sm"
          variant="secondary"
          icon="pr"
          render={<a href={action.href} target="_blank" rel="noreferrer" />}
          title={`Open ${action.label} on ${repo ? remoteNameOf(repo) : 'the remote'}: everything is committed and pushed`}
          data-testid="scm-open-pr"
        >
          {action.label}
        </Button>
      ) : action ? (
        <Button
          size="sm"
          variant={action.prominent ? 'primary' : 'secondary'}
          icon={action.mode === 'pr' || action.label.startsWith('PR #') ? 'pr' : 'commit'}
          onClick={() => {
            // Finishing a merge resumes the run that hit it (a PR stays a PR, its form as it was).
            if (!(repo?.mergeInProgress && opened)) setOpenMode(action.mode);
            setOpenAlias(undefined);
            setOpened(true);
            setOpen(true);
          }}
          title={waiting > 1 ? `${waiting} repositories have changes to ship — each is committed on its own` : undefined}
          data-testid="scm-open-dialog"
        >
          {waiting > 1 ? `${action.label} (${waiting})` : action.label}
        </Button>
      ) : null}
      {opened ? (
        <ShipDialog {...dialogProps} open={open} onOpenChange={setOpen} initialMode={openMode} {...(openAlias ? { initialAlias: openAlias } : {})} />
      ) : null}
    </>
  );
}

function ShipDialog({
  workspaceId,
  chatId,
  hint,
  onOpenFile,
  open,
  onOpenChange,
  initialMode,
  initialAlias,
}: ShipDialogProps & { open: boolean; onOpenChange: (open: boolean) => void; initialMode: ShipMode; initialAlias?: string }) {
  const flow = useShipFlow({ workspaceId, ...(hint ? { hint } : {}), open, initialMode, ...(initialAlias ? { initialAlias } : {}) });
  const { selected, result } = flow;
  if (!selected) return null;

  const openIn = (repoDir: string) =>
    onOpenFile ? { onOpenFile: (file: string) => onOpenFile(joinPath(repoDir, file)) } : {};
  const chat = chatId ? { chatId } : {};
  const rerun = () => void flow.rerun();
  // The dialog covers the chat the agent is about to work in: step aside, and say how to come back.
  const handOff = (files: readonly string[]) => {
    onOpenChange(false);
    flow.clearResult();
    toast.info(`The agent is resolving ${files.length === 1 ? files[0] : `${files.length} conflicted files`}`, {
      description: 'Watch it in the chat and check its changes, then press Finish merge to commit and push.',
      duration: 10_000,
    });
  };

  const conflicts =
    result?.status === 'conflicts' && result.conflicts ? (
      <ScmConflictActions
        key={`result-${flow.resultId}`}
        workspaceId={workspaceId}
        conflicts={result.conflicts}
        alias={result.alias}
        {...chat}
        {...openIn(result.readiness.repoDir)}
        onContinued={rerun}
        onAborted={flow.clearResult}
        onHandedToAgent={handOff}
      />
    ) : flow.availability.mergeInProgress ? (
      <ScmConflictActions
        key={`merge-${selected.alias}`}
        workspaceId={workspaceId}
        conflicts={{
          base: selected.mergingFrom ?? selected.defaultBranch ?? (flow.base.trim() || 'main'),
          head: selected.branch ?? 'HEAD',
          files: selected.conflictedFiles,
          mergeStarted: true,
        }}
        alias={selected.alias}
        {...chat}
        {...openIn(selected.repoDir)}
        onContinued={rerun}
        onAborted={flow.clearResult}
      />
    ) : null;

  const commitFiles: ShipFile[] = flow.commitFiles.map((f) => ({
    path: f.path,
    ...(f.oldPath ? { oldPath: f.oldPath } : {}),
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
  }));

  return (
    <ShipDialogView
      open={open}
      onOpenChange={onOpenChange}
      repos={flow.repos}
      selected={selected}
      onSelectAlias={flow.selectAlias}
      availability={flow.availability}
      mode={flow.mode}
      onModeChange={flow.setMode}
      checkingRemote={flow.checkingRemote}
      summary={flow.summary}
      onSummaryChange={flow.setSummary}
      description={flow.description}
      onDescriptionChange={flow.setDescription}
      commitFiles={commitFiles}
      prTitle={flow.prTitle}
      onPrTitleChange={flow.setPrTitle}
      prBody={flow.prBody}
      onPrBodyChange={flow.setPrBody}
      base={flow.base}
      onBaseChange={flow.setBase}
      branches={flow.branches}
      branchesLoading={flow.branchesLoading}
      compare={flow.compare}
      compareLoading={flow.compareLoading}
      prOptions={flow.prOptions}
      prOptionsLoading={flow.prOptionsLoading}
      reviewers={flow.reviewers}
      onReviewersChange={flow.setReviewers}
      assignees={flow.assignees}
      onAssigneesChange={flow.setAssignees}
      labels={flow.labels}
      onLabelsChange={flow.setLabels}
      closesIssues={flow.closesIssues}
      onClosesIssuesChange={flow.setClosesIssues}
      generating={flow.generating}
      onGenerate={(kind) => void flow.generate(kind)}
      running={flow.running}
      result={result}
      onDismissResult={flow.clearResult}
      onRun={(draft) => void flow.run(draft)}
      allTargets={flow.allTargets}
      allResults={flow.allResults}
      runningAll={flow.runningAll}
      onRunAll={(draft) => void flow.runAll(draft)}
      conflicts={conflicts}
    />
  );
}
