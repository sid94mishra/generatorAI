// ────────────────────────────────────────────────────────────────
// CommitBar — the Changes panel's commit → push → PR footer (F-dock-01).
//
// Readiness-driven (`GET /scm/readiness`): each mount states what it can do
// and, when it cannot, exactly why — with the fix one click away when the fix
// is "connect an account". One primary action runs the whole flow
// (`POST /scm/flow`). Renders nothing without a workspace or when readiness
// reports no repos. Hiding it at 0 changes is the host's call (a clean branch
// can still have commits to push, or a merge to finish).
// ────────────────────────────────────────────────────────────────

import { joinPath } from '@/blocks/changes/changePaths.js';
import { CommitBarLoading, CommitBarView } from './CommitBarView.js';
import { ScmConflictActions } from './ScmConflictActions.js';
import { useCommitBar } from './useCommitBar.js';

export { ScmResultSummary } from './CommitBarView.js';
export { pickDefaultAlias } from './scmFlow.js';

export interface CommitBarProps {
  workspaceId: string | undefined;
  /** Chat that owns this workspace, when there is one — gates "Ask the agent". */
  chatId?: string;
  /** Seeds generated commit/PR text (the chat name or the run's task). */
  hint?: string;
  /** Opens a path in the user's editor; omitted when that is unavailable. */
  onOpenFile?: (absolutePath: string) => void;
  className?: string;
}

export function CommitBar({ workspaceId, chatId, hint, onOpenFile, className }: CommitBarProps) {
  const bar = useCommitBar({ workspaceId, ...(hint ? { hint } : {}) });
  const { selected, result } = bar;

  if (!workspaceId) return null;
  if (bar.loading) return <CommitBarLoading {...(className ? { className } : {})} />;
  if (!selected) return null;

  const openIn = (repoDir: string) =>
    onOpenFile ? { onOpenFile: (file: string) => onOpenFile(joinPath(repoDir, file)) } : {};
  const chat = chatId ? { chatId } : {};
  const rerun = () => void bar.runFlow();

  const conflicts =
    result?.status === 'conflicts' && result.conflicts ? (
      <ScmConflictActions
        key={`result-${bar.resultId}`}
        workspaceId={workspaceId}
        conflicts={result.conflicts}
        alias={result.alias}
        {...chat}
        {...openIn(result.readiness.repoDir)}
        onContinued={rerun}
        onAborted={bar.clearResult}
      />
    ) : bar.availability.mergeInProgress ? (
      <ScmConflictActions
        key={`merge-${selected.alias}`}
        workspaceId={workspaceId}
        conflicts={{
          base: selected.defaultBranch ?? (bar.base.trim() || 'main'),
          head: selected.branch ?? 'HEAD',
          files: selected.conflictedFiles,
          mergeStarted: true,
        }}
        alias={selected.alias}
        {...chat}
        {...openIn(selected.repoDir)}
        onContinued={rerun}
        onAborted={bar.clearResult}
      />
    ) : null;

  return (
    <CommitBarView
      repos={bar.repos}
      selected={selected}
      onSelectAlias={bar.selectAlias}
      availability={bar.availability}
      message={bar.message}
      onMessageChange={bar.setMessage}
      push={bar.push}
      onPushChange={bar.setPush}
      openPr={bar.openPr}
      onOpenPrChange={bar.setOpenPr}
      prTitle={bar.prTitle}
      onPrTitleChange={bar.setPrTitle}
      prBody={bar.prBody}
      onPrBodyChange={bar.setPrBody}
      base={bar.base}
      onBaseChange={bar.setBase}
      draft={bar.draft}
      onDraftChange={bar.setDraft}
      generating={bar.generating}
      onGenerate={(kind) => void bar.generate(kind)}
      running={bar.running}
      result={result}
      onRun={rerun}
      conflicts={conflicts}
      {...(className ? { className } : {})}
    />
  );
}
