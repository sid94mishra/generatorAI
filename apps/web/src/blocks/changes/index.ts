// ────────────────────────────────────────────────────────────────
// blocks/changes — the Changes panel's data layer (03-domain §6.3).
//
// P4-04 extracted these hooks from components/diff/ChangesSurface.tsx, which
// is now a thin view over them; the P4-09 `blocks/changes` view consumes the
// same hooks. Each hook returns plain values and stable callbacks; rendering,
// dialogs and toasts stay with the host (confirm/warn are injected).
// ────────────────────────────────────────────────────────────────

export type {
  DiffAnnotation,
  DiffAnnotationMeta,
  DiffCodeViewHandle,
  DiffLineRange,
  DiffSource,
  DiffViewMode,
} from './diffTypes.js';
export { diffSourceId, useDiffSources, useExpandedDiffs, type DiffSourceEntry } from './useDiffSources.js';
export { useChangesModel, type ChangesModel, type CompareOption } from './useChangesModel.js';
export { useChangesViewSettings, useCheckpointPanel, type TreePosition } from './useChangesViewSettings.js';
export { useChangesNavigation } from './useChangesNavigation.js';
export {
  useFileActions,
  type BulkAction,
  type ChangesNotice,
  type ConfirmRequest,
  type FileActions,
  type MountRevisions,
} from './useFileActions.js';
export { splitKeptFiles, useKeptFiles } from './useKeptFiles.js';
export { useReviewOverlay, type PendingSelection } from './useReviewOverlay.js';
export { useChangesEditor } from './useChangesEditor.js';
