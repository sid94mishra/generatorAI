// ────────────────────────────────────────────────────────────────
// F-dock-01 ChangeFileRow — one changed file's header in the Changes dock
// (03-domain §3.3; board DockChanges). A pure view: the panel wires it into
// B-07 DiffView's `renderHeader`.
//
// chevron · file glyph · path (one text node, findable by its text; alias prefix with several
// mounts; `old → new` for renames) · comment badge · ± (or binary / too large)
// · status letter (shared CHANGE_KIND) · actions: Comment, Keep / Unkeep,
// Open in editor, Undo → inline "Confirm undo" (D-28).
//
// The whole row toggles the diff (a pointer convenience — deliberately not
// `role="button"`, the row holds its own buttons); the chevron is the
// keyboard / screen-reader control and carries the accessible name. Actions
// are revealed on hover / focus, always shown on a kept row. Height comes from
// the host (`height`) because the diff virtualizer must know it exactly.
// ────────────────────────────────────────────────────────────────

import type { MouseEvent } from 'react';
import { CHANGE_KIND, type ChangeKindTone } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { DiffStat } from '@/ui/patterns/DiffStat/DiffStat.js';
import type { ChangeStatus } from '@/types/changes.js';

/** Status letter tone → text utility. */
export const CHANGE_TONE_CLASS: Record<ChangeKindTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  run: 'text-run',
  'fg-3': 'text-fg-3',
};

export interface ChangeFileRowFile {
  status: ChangeStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isTooLarge: boolean;
}

export interface ChangeFileRowProps {
  /** Repo-relative path. */
  path: string;
  /** Mount alias; shown as a prefix when `showAlias`. */
  alias: string;
  showAlias: boolean;
  /** What the file is called on screen (the path's title / tooltip). */
  displayPath: string;
  /** Summary metadata; undefined while the row is unknown to the summary. */
  file: ChangeFileRowFile | undefined;
  height: number;
  expanded: boolean;
  active: boolean;
  /** The body is being fetched. */
  loading: boolean;
  kept: boolean;
  /** A per-row action is running (spinner on that row only). */
  busy: boolean;
  /** The inline "Confirm undo" is showing. */
  confirmingUndo: boolean;
  /** Open review threads on this file. */
  commentCount: number;
  onToggle: () => void;
  onKeep: () => void;
  onUnkeep: () => void;
  /** Omitted when no editor can open files. */
  onOpenInEditor?: () => void;
  /** Omitted when the mount has no base to restore from. */
  onRequestUndo?: () => void;
  onConfirmUndo: () => void;
  onCancelUndo: () => void;
  /** Review: comment on a line range (omitted when review is off or the row is closed). */
  onComment?: (anchor: { x: number; y: number }) => void;
  /** The comment control waits for the file body. */
  commentDisabled?: boolean;
}

const stop = (handler: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  handler();
};

export function ChangeFileRow({
  path,
  alias,
  showAlias,
  displayPath,
  file,
  height,
  expanded,
  active,
  loading,
  kept,
  busy,
  confirmingUndo,
  commentCount,
  onToggle,
  onKeep,
  onUnkeep,
  onOpenInEditor,
  onRequestUndo,
  onConfirmUndo,
  onCancelUndo,
  onComment,
  commentDisabled = false,
}: ChangeFileRowProps) {
  const openable = !file?.isBinary && !file?.isTooLarge;
  const kind = CHANGE_KIND[file?.status ?? 'modified'];
  return (
    <div
      className={cn(
        'group relative flex w-full min-w-0 items-center gap-1.5 border-b border-line-soft pr-1 pl-1.5 text-small transition-control',
        openable && 'cursor-pointer',
        active ? 'bg-selected' : expanded ? 'bg-sunken' : 'bg-surface',
        !active && 'hover:bg-hover',
      )}
      style={{ height }}
      onClick={() => {
        if (openable) onToggle();
      }}
    >
      {active ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" /> : null}
      <IconButton
        size="sm"
        icon={expanded ? 'chevron-down' : 'chevron-right'}
        label={expanded ? `Collapse ${path}` : `Expand ${path}`}
        tooltip={expanded ? 'Hide changes' : 'Show changes'}
        aria-expanded={expanded}
        disabled={!openable}
        loading={loading}
        onClick={stop(() => {
          if (openable) onToggle();
        })}
      />
      <Icon concept="file" size={14} className="text-fg-3" />
      <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg" title={displayPath}>
        {showAlias && alias !== '.' ? <span className="text-fg-3">{alias}/</span> : null}
        {file?.oldPath ? <span className="text-fg-3 line-through">{file.oldPath} → </span> : null}
        {path}
      </span>
      {commentCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 rounded-badge bg-selected px-1 font-mono text-micro text-fg-2"
          title={`${commentCount} comment${commentCount === 1 ? '' : 's'} on this file`}
        >
          <Icon concept="message" size={12} />
          {commentCount}
        </span>
      ) : null}
      {file ? (
        file.isBinary ? (
          <span className="shrink-0 text-micro text-fg-3">binary</span>
        ) : file.isTooLarge ? (
          <span className="shrink-0 text-micro text-fg-3">too large</span>
        ) : (
          <DiffStat added={file.additions} removed={file.deletions} className="shrink-0" />
        )
      ) : null}
      <span
        className={cn('w-3 shrink-0 text-center font-mono text-micro font-semibold', CHANGE_TONE_CLASS[kind.tone])}
        title={kind.label}
      >
        {kind.letter}
      </span>
      {confirmingUndo ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            loading={busy}
            data-testid="confirm-undo-file"
            onClick={stop(onConfirmUndo)}
          >
            {busy ? 'Undoing…' : 'Confirm undo'}
          </Button>
          <Button size="sm" variant="ghost" onClick={stop(onCancelUndo)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span
          className={cn(
            'flex shrink-0 items-center gap-0.5 transition-control',
            kept || busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          {onComment ? (
            <IconButton
              size="sm"
              icon="message"
              label={`Comment on ${path}`}
              tooltip="Comment on a line range"
              disabled={commentDisabled}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onComment({ x: rect.left, y: rect.bottom });
              }}
            />
          ) : null}
          {kept ? (
            <IconButton
              size="sm"
              icon="retry"
              label={`Unkeep ${path}`}
              tooltip="Put this file back in the review list"
              data-testid="unkeep-file"
              disabled={busy}
              loading={busy}
              onClick={stop(onUnkeep)}
            />
          ) : (
            <IconButton
              size="sm"
              icon="check"
              label={`Keep ${path}`}
              tooltip="Keep — mark reviewed and move out of the list"
              data-testid="keep-file"
              disabled={busy}
              loading={busy}
              onClick={stop(onKeep)}
            />
          )}
          {onOpenInEditor ? (
            <IconButton
              size="sm"
              icon="external-link"
              label={`Open ${path} in editor`}
              tooltip="Open in editor"
              data-testid="open-file-in-editor"
              onClick={stop(onOpenInEditor)}
            />
          ) : null}
          {onRequestUndo ? (
            <IconButton
              size="sm"
              icon="undo"
              label={`Undo changes to ${path}`}
              tooltip="Undo this file's changes"
              data-testid="undo-file"
              disabled={busy}
              onClick={stop(onRequestUndo)}
            />
          ) : null}
        </span>
      )}
    </div>
  );
}

