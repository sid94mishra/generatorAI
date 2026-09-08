// The one Changes surface (D20): every screen that shows a diff — the
// workbench pane, the route screens, the composer tray — builds from here.

export { ChangesList, type ChangesListProps } from './ChangesList';
export { FileDiff, EMBEDDED_ROW_LIMIT, type FileDiffProps, type CommentRequest } from './FileDiff';
export { FileDiffPane, type FileDiffPaneProps } from './FileDiffPane';
export { DiffLine, type DiffLineProps } from './DiffLine';
export { HunkHeader } from './HunkHeader';
export { CommitBar } from './CommitBar';
export { Toolbar } from './Toolbar';
export { useChangesSummary, type ChangeRow, type ChangesSummaryState } from './useChangesSummary';
export { useDiffPrefs, setDiffWrap, setDiffFontSize, setDiffLayout, getDiffPrefs, type DiffPrefs, type DiffLayout } from './diffPrefs';
export { useWorkspaceExtras, createWorkspaceExtras, requestJson, json, ApiError, type CheckpointRow, type ChangeSummaryV2 } from './api';
export * from './statusStyle';
export * from './diffModel';
