// ────────────────────────────────────────────────────────────────
// ShipDialog — the Changes toolbar's ship button and the commit / push / PR
// dialog it opens (D-163). Replaces the CommitBar footer.
//
// The button names the next step for the repo's state (Commit · Push ·
// Pull request · PR #12), from readiness; nothing to ship, no button. The
// dialog is ShipDialogView fed by useShipFlow, plus the conflict card when a
// sync collides or a merge is already in progress.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { joinPath } from '@/blocks/changes/changePaths.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { ScmConflictActions } from './ScmConflictActions.js';
import { ShipDialogView, type ShipFile } from './ShipDialogView.js';
import { pickDefaultAlias, shipActionOf, type ShipMode } from './scmFlow.js';
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
}

/** The toolbar button; renders nothing when the workspace has nothing to commit, push or propose. */
export function ShipButton(props: ShipDialogProps) {
  const readiness = useWorkspaceReadiness(props.workspaceId);
  const repos = readiness.data?.repos ?? [];
  const repo = repos.find((r) => r.alias === pickDefaultAlias(repos));
  const action = shipActionOf(repo);
  const [open, setOpen] = useState(false);
  // The mode is fixed when the dialog opens: the button's verb changes as the flow runs
  // (Commit → PR #12), and the dialog must keep showing that run's outcome.
  const [openMode, setOpenMode] = useState<ShipMode>('commit');
  // Mounted from the first open on, so a closed dialog keeps what was typed into it.
  const [opened, setOpened] = useState(false);
  return (
    <>
      {action ? (
        <Button
          size="sm"
          variant={action.prominent ? 'primary' : 'secondary'}
          icon={action.mode === 'pr' || action.label.startsWith('PR #') ? 'pr' : 'commit'}
          onClick={() => {
            setOpenMode(action.mode);
            setOpened(true);
            setOpen(true);
          }}
          data-testid="scm-open-dialog"
        >
          {action.label}
        </Button>
      ) : null}
      {opened ? <ShipDialog {...props} open={open} onOpenChange={setOpen} initialMode={openMode} /> : null}
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
}: ShipDialogProps & { open: boolean; onOpenChange: (open: boolean) => void; initialMode: ShipMode }) {
  const flow = useShipFlow({ workspaceId, ...(hint ? { hint } : {}), open, initialMode });
  const { selected, result } = flow;
  if (!selected) return null;

  const openIn = (repoDir: string) =>
    onOpenFile ? { onOpenFile: (file: string) => onOpenFile(joinPath(repoDir, file)) } : {};
  const chat = chatId ? { chatId } : {};
  const rerun = () => void flow.run(false);

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
      />
    ) : flow.availability.mergeInProgress ? (
      <ScmConflictActions
        key={`merge-${selected.alias}`}
        workspaceId={workspaceId}
        conflicts={{
          base: selected.defaultBranch ?? (flow.base.trim() || 'main'),
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
      conflicts={conflicts}
    />
  );
}
