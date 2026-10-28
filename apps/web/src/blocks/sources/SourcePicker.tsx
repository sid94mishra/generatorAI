// ────────────────────────────────────────────────────────────────
// B-04 SourcePicker — "what should this chat work on?" (the Where section)
// ────────────────────────────────────────────────────────────────
//
// One editor, three hosts: the NewChat dialog (`compact`), the ChatCreate page
// and "Edit sources…" on a live chat (full). All produce the same
// `ChatSourceSpec[]` + primary alias, so the rules (which modes a source
// supports, what a new branch is called, which mount is the agent's cwd) are
// defined once, in `model.ts`.
//
// The list is ordered and the first entry is the agent's working directory
// unless another is made primary — that ordering IS the contract with the
// server, so the up/down controls are functional, not decoration.
//
// Layouts (both D-133/D-136: labels above controls on one left edge, ONE
// bordered list using `line` so it holds on a dialog's `overlay` surface):
//   compact — the NewChat dialog: a "Project" field and the list. Included
//             sources expand in place (checkbox, mono name, "Working
//             directory" badge, Mode, then the branch line); project codebases
//             that are not ticked collapse to a single "Not included" row;
//             "Add local folder" sits in the list footer.
//   full    — the ChatCreate page and "Edit sources…": the same list, each
//             source row adding rename, reorder / remove, the user's folder +
//             copy, and "Make working directory".
// "Add local folder" opens the OS folder dialog in the desktop app on its own
// server, else the server-side browser (`useFolderPicker`, D-136).
//
// Kit rebuild of `components/chat/sources/SourcePicker.tsx` (P5-09).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../ui/primitives/Badge/Badge.js';
import { Button } from '../../ui/primitives/Button/Button.js';
import { Callout } from '../../ui/primitives/Callout/Callout.js';
import { Checkbox } from '../../ui/primitives/Checkbox/Checkbox.js';
import { Field } from '../../ui/primitives/Field/Field.js';
import { IconButton } from '../../ui/primitives/IconButton/IconButton.js';
import { Input } from '../../ui/primitives/Input/Input.js';
import { Menu } from '../../ui/primitives/Menu/Menu.js';
import { Chip } from '../../ui/primitives/Chip/Chip.js';
import { PopoverClose, PopoverPopup, PopoverRoot, PopoverTrigger } from '../../ui/primitives/Popover/Popover.js';
import { SegmentedControl, type SegmentedItem } from '../../ui/primitives/SegmentedControl/SegmentedControl.js';
import { Select } from '../../ui/primitives/Select/Select.js';
import { Spinner } from '../../ui/primitives/Spinner/Spinner.js';
import { Tooltip } from '../../ui/primitives/Tooltip/Tooltip.js';
import { Icon } from '../../ui/icons/Icon.js';
import { cn } from '../../ui/lib/cn.js';
import { useProjects, useProjectCodebases, useCodebaseBranches } from '../../hooks/projectQueries.js';
import { useFsGitInfo, useReadFsGitInfo } from '../../hooks/sourceQueries.js';
import { pathTail } from '@generatorai/client-core';
import { useFolderPicker } from '../directory-browser/useFolderPicker.js';
import {
  defaultNewBranch,
  draftFromCodebase,
  draftFromFolder,
  sourcesSummary,
  type BranchMode,
  type CodebaseLike,
  type DraftSource,
  type SourceMode,
  autoIncludedCodebase,
  draftFromChatFolder,
  draftSetupKey,
  effectiveBranch,
} from './model.js';

export interface SourcePickerProps {
  /** Drives the `generatorai/<slug>` branch placeholder. */
  chatName: string;
  projectId: string;
  onProjectIdChange: (projectId: string) => void;
  drafts: DraftSource[];
  onChange: (next: DraftSource[]) => void;
  /** Alias of the agent's working directory; defaults to the first source. */
  primaryAlias?: string | undefined;
  onPrimaryChange: (alias: string) => void;
  /** Inline message from the server's 400 (or a local rule). */
  error?: string | null;
  disabled?: boolean;
  /** Max sources the server accepts. */
  maxSources?: number;
  /**
   * The denser NewChat dialog layout: checkbox-driven list, no reorder / copy
   * / rename chrome, per-source controls only once a source is included.
   * Default false (ChatCreate page, "Edit sources…").
   */
  compact?: boolean;
  /**
   * Editing a live chat ("Edit sources…"): a kept worktree whose setup
   * changes is rebuilt on save, so the row says so (D-166).
   */
  live?: boolean;
  /**
   * Files in the chat folder (D-141). When the user unticks it the full list
   * keeps an unticked row so it can be ticked back before saving.
   */
  chatFolderFiles?: number;
}

/** Base UI Select treats `''` poorly as a value; these stand in for "none". */
const NO_PROJECT = '__no-project__';
const CURRENT_HEAD = '__current-head__';

const EMPTY_HINT = 'Nothing linked yet. The agent starts in an empty folder of its own — add a folder to work on your files.';

/** The project codebase row shape this picker reads (from `useProjectCodebases`). */
interface ProjectCodebase {
  id: string;
  alias: string;
  type: string;
  status: string;
  url?: string | undefined;
  localPath?: string | undefined;
  defaultBranch?: string | undefined;
}

function toCodebaseLike(cb: ProjectCodebase): CodebaseLike {
  return {
    id: cb.id,
    alias: cb.alias,
    type: cb.type,
    ...(cb.url ? { url: cb.url } : {}),
    ...(cb.localPath ? { localPath: cb.localPath } : {}),
    ...(cb.defaultBranch ? { defaultBranch: cb.defaultBranch } : {}),
  };
}

export function SourcePicker({
  chatName,
  projectId,
  onProjectIdChange,
  drafts,
  onChange,
  primaryAlias,
  onPrimaryChange,
  error,
  disabled = false,
  maxSources = 8,
  compact = false,
  live = false,
  chatFolderFiles = 0,
}: SourcePickerProps) {
  const readGitInfo = useReadFsGitInfo();
  const { data: projects } = useProjects();
  const { data: codebases, isLoading: codebasesLoading } = useProjectCodebases(projectId || undefined);

  const takenAliases = useMemo(() => drafts.map((d) => d.alias), [drafts]);
  const effectivePrimary = primaryAlias ?? drafts[0]?.alias;
  const atLimit = drafts.length >= maxSources;

  const replaceAt = useCallback(
    (index: number, next: DraftSource) => {
      const copy = [...drafts];
      copy[index] = next;
      onChange(copy);
      // Renaming the primary must not silently demote it.
      if (drafts[index]?.alias === effectivePrimary && next.alias !== effectivePrimary) {
        onPrimaryChange(next.alias);
      }
    },
    [drafts, onChange, effectivePrimary, onPrimaryChange],
  );

  const removeAt = useCallback(
    (index: number) => {
      const removed = drafts[index];
      const next = drafts.filter((_, i) => i !== index);
      onChange(next);
      if (removed && removed.alias === effectivePrimary) {
        onPrimaryChange(next[0]?.alias ?? '');
      }
    },
    [drafts, onChange, effectivePrimary, onPrimaryChange],
  );

  const toggleCodebase = useCallback(
    (cb: CodebaseLike) => {
      const existing = drafts.findIndex((d) => d.kind === 'codebase' && d.codebaseId === cb.id);
      if (existing >= 0) {
        removeAt(existing);
        return;
      }
      if (atLimit) return;
      const draft = draftFromCodebase(cb, takenAliases);
      const next = [...drafts, draft];
      onChange(next);
      if (next.length === 1) onPrimaryChange(draft.alias);
    },
    [drafts, removeAt, atLimit, takenAliases, onChange, onPrimaryChange],
  );

  // D-108: a project's only codebase is included when the project is picked (once per project, so unticking sticks).
  const autoIncludedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || !codebases || autoIncludedFor.current === projectId) return;
    autoIncludedFor.current = projectId;
    const only = autoIncludedCodebase(codebases, drafts);
    if (only) toggleCodebase(toCodebaseLike(only));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- decided once, when the project's codebases arrive
  }, [projectId, codebases]);

  /**
   * Add a folder, resolving its git facts FIRST.
   *
   * Doing it here rather than in an effect on the row keeps `meta` the single
   * authority for what the source can do: validation and the mode toggle read
   * the same object, so a plain folder can never be submitted as a worktree
   * because the answer had not arrived yet.
   */
  const addFolder = useCallback(
    async (path: string) => {
      if (atLimit) return;
      let info;
      try {
        info = await readGitInfo(path);
      } catch {
        info = undefined;
      }
      const draft = draftFromFolder(path, info, takenAliases);
      if (!info) {
        draft.meta.loading = false;
        draft.meta.allowWorktree = false;
        draft.meta.allowWorktreeReason = 'Could not read this folder — check that the path exists.';
      }
      const next = [...drafts, draft];
      onChange(next);
      if (next.length === 1) onPrimaryChange(draft.alias);
    },
    [atLimit, readGitInfo, takenAliases, drafts, onChange, onPrimaryChange],
  );

  const folderPicker = useFolderPicker({
    onPick: (p) => void addFolder(p),
    description: 'The agent will work in the folder you pick.',
  });

  const selectedCodebaseIds = useMemo(
    () => new Set(drafts.filter((d) => d.kind === 'codebase').map((d) => d.codebaseId)),
    [drafts],
  );

  const projectItems = useMemo(
    () => [
      { value: NO_PROJECT, label: 'No project' },
      ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name })),
    ],
    [projects],
  );

  const projectSelect = (
    <Select
      id="chat-project"
      aria-label="Project"
      size="sm"
      disabled={disabled}
      value={projectId || NO_PROJECT}
      onValueChange={(v) => onProjectIdChange(!v || v === NO_PROJECT ? '' : v)}
      items={projectItems}
      className="w-full"
    />
  );

  const addFolderButton = (
    <Button
      variant="ghost"
      size="sm"
      icon="plus"
      disabled={disabled || atLimit}
      onClick={() => void folderPicker.open()}
      data-testid="add-local-folder"
    >
      Add local folder
    </Button>
  );

  const limitNote = atLimit ? (
    <span className="text-small text-fg-3">Maximum of {maxSources} sources reached.</span>
  ) : null;

  const rowProps = (draft: DraftSource, index: number): SourceRowProps => ({
    draft,
    index,
    total: drafts.length,
    chatName,
    projectId,
    disabled,
    live,
    isPrimary: draft.alias === effectivePrimary,
    onChange: (next) => replaceAt(index, next),
    onRemove: () => removeAt(index),
    onMakePrimary: () => onPrimaryChange(draft.alias),
  });

  const codebaseStatus = projectId ? (
    codebasesLoading ? (
      <div className="flex items-center gap-2 text-small text-fg-3">
        <Spinner size={14} label="Loading codebases" /> Loading codebases…
      </div>
    ) : !codebases || codebases.length === 0 ? (
      <p className="text-small text-fg-3">This project has no codebases yet.</p>
    ) : null
  ) : null;

  const footer = (
    <>
      {/* Each full row states its own setup; the compact list keeps the one-line summary. */}
      {compact && drafts.length > 0 && (
        <p className="text-small text-fg-3" data-testid="sources-summary">
          {sourcesSummary(drafts, chatName)}
        </p>
      )}
      {error && (
        <Callout tone="err" role="alert">
          {error}
        </Callout>
      )}
      {folderPicker.dialog}
    </>
  );

  const notIncluded = (codebases ?? []).filter((cb) => !selectedCodebaseIds.has(cb.id));

  if (!compact) {
    // D-167: one list scoped to the project. The header switches project and
    // adds a folder; every codebase is a ticked or unticked row; each included
    // source reads as one sentence whose parts are the controls.
    const included = drafts.filter((d) => d.kind === 'codebase').length;
    const keepChatFolder = chatFolderFiles > 0 && !drafts.some((d) => d.kind === 'chat-folder');
    return (
      <div className="flex flex-col gap-2">
        <ul className="rounded-card border border-line-soft" data-testid="source-list" aria-label="Sources">
          <li className="flex h-panel-bar items-center gap-2 border-b border-line-soft pr-2 pl-1.5">
            <ProjectSwitcher
              projects={projectItems}
              value={projectId || NO_PROJECT}
              disabled={disabled}
              onChange={(v) => onProjectIdChange(v === NO_PROJECT ? '' : v)}
            />
            {codebases && codebases.length > 0 ? (
              <span className="truncate text-small text-fg-3">
                {codebases.length} {codebases.length === 1 ? 'codebase' : 'codebases'} · {included} in this chat
              </span>
            ) : null}
            <span className="flex-1" />
            {limitNote}
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              disabled={disabled || atLimit}
              onClick={() => void folderPicker.open()}
              data-testid="add-local-folder"
            >
              Local folder
            </Button>
          </li>
          {codebaseStatus ? <li className="border-b border-line-soft px-3 py-2.5">{codebaseStatus}</li> : null}
          {drafts.map((draft, index) => (
            <li key={draft.key} className="border-b border-line-soft last:border-b-0">
              {draft.kind === 'chat-folder' ? <ChatFolderListRow {...rowProps(draft, index)} /> : <SourceRow {...rowProps(draft, index)} />}
            </li>
          ))}
          {notIncluded.map((cb) => (
            <li key={cb.id} className="border-b border-line-soft last:border-b-0">
              <CodebaseOption
                cb={cb}
                checked={false}
                disabled={disabled || atLimit || cb.status !== 'ready'}
                onToggle={() => toggleCodebase(toCodebaseLike(cb))}
              />
            </li>
          ))}
          {keepChatFolder ? (
            <li className="border-b border-line-soft last:border-b-0">
              <ChatFolderOption
                files={chatFolderFiles}
                disabled={disabled || atLimit}
                onKeep={() => onChange([...drafts, draftFromChatFolder(chatFolderFiles)])}
              />
            </li>
          ) : null}
          {drafts.length === 0 && notIncluded.length === 0 && !keepChatFolder && (
            <li className="px-3 py-2.5 text-small text-fg-3">{EMPTY_HINT}</li>
          )}
        </ul>
        {footer}
      </div>
    );
  }

  const Row = CompactSourceRow;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Project">{projectSelect}</Field>
      <div className="flex flex-col gap-2">
        {codebaseStatus}
        <ul className="overflow-hidden rounded-card border border-line" data-testid="source-list">
          {drafts.map((draft, index) => (
            <li key={draft.key} className="border-b border-line">
              {draft.kind === 'chat-folder' ? <ChatFolderRow {...rowProps(draft, index)} /> : <Row {...rowProps(draft, index)} />}
            </li>
          ))}
          {notIncluded.map((cb) => (
            <li key={cb.id} className="border-b border-line">
              <CodebaseOption
                cb={cb}
                checked={false}
                disabled={disabled || atLimit || cb.status !== 'ready'}
                onToggle={() => toggleCodebase(toCodebaseLike(cb))}
              />
            </li>
          ))}
          {drafts.length === 0 && (
            <li className="border-b border-line px-3 py-2.5 text-small text-fg-3">{EMPTY_HINT}</li>
          )}
          <li className="flex items-center gap-2 px-1.5 py-1.5">
            {addFolderButton}
            {limitNote}
          </li>
        </ul>
        {footer}
      </div>
    </div>
  );
}

// ── A project codebase in the checklist ────────────────────────

function CodebaseOption({
  cb,
  checked,
  disabled,
  onToggle,
}: {
  cb: ProjectCodebase;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const origin = cb.url ?? cb.localPath;
  return (
    <div className="flex h-row items-center gap-2.5 pr-2.5 pl-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={`Include ${cb.alias}`}
      />
      <Icon concept={cb.type === 'local-dir' ? 'folder-open' : 'branch'} size={14} className="shrink-0 text-fg-3" />
      <span className={cn('shrink-0 font-mono text-ui', checked ? 'text-fg' : 'text-fg-2')}>{cb.alias}</span>
      {origin ? (
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-fg-3" title={origin}>
          {origin}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {cb.status !== 'ready' ? (
        <Badge tone="warn">{cb.status}</Badge>
      ) : checked ? (
        <span className="shrink-0 text-small text-fg-2">Included</span>
      ) : (
        <span className="shrink-0 text-small text-fg-3">Not included</span>
      )}
    </div>
  );
}

// ── One source: shared data + controls ────────────────────────

interface SourceRowProps {
  draft: DraftSource;
  index: number;
  total: number;
  chatName: string;
  projectId: string;
  disabled: boolean;
  live: boolean;
  isPrimary: boolean;
  onChange: (next: DraftSource) => void;
  onRemove: () => void;
  onMakePrimary: () => void;
}

/**
 * Branch lists come from whichever side owns them: a codebase's are served by
 * the project API, a folder's by `fs/git-info`. Both are read-only here — the
 * draft's own `meta` stays the authority for what the source CAN do.
 */
function useSourceFacts(draft: DraftSource, projectId: string) {
  const codebaseBranches = useCodebaseBranches(
    draft.kind === 'codebase' && projectId ? projectId : undefined,
    draft.kind === 'codebase' ? draft.codebaseId : undefined,
  );
  const folderInfo = useFsGitInfo(draft.kind === 'folder' ? draft.path : undefined);

  const branches = useMemo(() => {
    const set = new Set<string>(draft.meta.branches);
    for (const b of codebaseBranches.data ?? []) set.add(b);
    for (const b of folderInfo.data?.branches ?? []) set.add(b);
    if (draft.meta.defaultBranch) set.add(draft.meta.defaultBranch);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [draft.meta.branches, draft.meta.defaultBranch, codebaseBranches.data, folderInfo.data]);

  return {
    branches,
    dirty: folderInfo.data?.dirty ?? draft.meta.dirty ?? false,
    nested: folderInfo.data?.nestedRepos ?? draft.meta.nestedRepos ?? [],
    currentBranch: folderInfo.data?.currentBranch ?? draft.meta.defaultBranch ?? null,
  };
}

type SourceFacts = ReturnType<typeof useSourceFacts>;

/** An item disabled by the whole picker shows no reason; one the source rules out explains itself. */
function segItem<V extends string>(
  value: V,
  label: string,
  pickerDisabled: boolean,
  blocked = false,
  reason?: string,
): SegmentedItem<V> {
  return {
    value,
    label,
    disabled: pickerDisabled || blocked,
    ...(blocked && reason ? { reason } : {}),
  };
}

function ModeControl({ draft, disabled, onChange }: Pick<SourceRowProps, 'draft' | 'disabled' | 'onChange'>) {
  const setMode = (mode: SourceMode) => {
    // A worktree always lands on a branch of its own, so "leave it where it
    // is" is not a coherent answer once the mode flips.
    const branchMode: BranchMode = mode === 'worktree' && draft.branchMode === 'current' ? 'new' : draft.branchMode;
    onChange({ ...draft, mode, branchMode });
  };
  return (
    <SegmentedControl<SourceMode>
      label={`Mode for ${draft.alias}`}
      value={draft.mode}
      onValueChange={setMode}
      items={[
        segItem('worktree', 'Worktree', disabled, !draft.meta.allowWorktree, draft.meta.allowWorktreeReason),
        segItem('in-place', 'In place', disabled, !draft.meta.allowInPlace, draft.meta.allowInPlaceReason),
      ]}
    />
  );
}

function BranchControls({
  draft,
  chatName,
  disabled,
  onChange,
  facts,
}: Pick<SourceRowProps, 'draft' | 'chatName' | 'disabled' | 'onChange'> & { facts: SourceFacts }) {
  const { branches, currentBranch } = facts;
  const branchItems = branches.map((b) => ({ value: b, label: b }));
  return (
    <>
      <SegmentedControl<BranchMode>
        label={`Branch for ${draft.alias}`}
        value={draft.branchMode}
        onValueChange={(branchMode) => onChange({ ...draft, branchMode })}
        items={[
          // A worktree with no branch of its own would fight the checkout it
          // was cut from, so "current" is offered only for in-place mounts.
          ...(draft.mode === 'in-place'
            ? [segItem<BranchMode>('current', currentBranch ? `Stay on ${currentBranch}` : 'Current branch', disabled)]
            : []),
          segItem<BranchMode>('new', 'New branch', disabled),
          segItem<BranchMode>(
            'existing',
            'Existing branch',
            disabled,
            branches.length === 0,
            'No branches were found in this repository.',
          ),
        ]}
      />

      {draft.branchMode === 'new' && (
        // One unit that wraps TOGETHER, so "from" never dangles at the end of
        // one line with the base it refers to on the next.
        <div className="flex min-w-0 flex-1 basis-72 flex-wrap items-center gap-x-2 gap-y-1.5">
          <Input
            size="sm"
            mono
            value={draft.newBranch}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, newBranch: e.target.value })}
            placeholder={defaultNewBranch(chatName)}
            aria-label={`New branch name for ${draft.alias}`}
            className="min-w-52 flex-1"
          />
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className="text-small text-fg-3">from</span>
            <Select
              size="sm"
              value={draft.baseRef || CURRENT_HEAD}
              disabled={disabled}
              onValueChange={(v) => onChange({ ...draft, baseRef: !v || v === CURRENT_HEAD ? '' : v })}
              aria-label={`Base branch for ${draft.alias}`}
              className="w-40 font-mono"
              items={[
                { value: CURRENT_HEAD, label: currentBranch ? `Current (${currentBranch})` : 'Current HEAD' },
                ...branchItems,
              ]}
            />
          </span>
        </div>
      )}

      {draft.branchMode === 'existing' && (
        <Select
          size="sm"
          value={draft.branch || null}
          disabled={disabled || branches.length === 0}
          onValueChange={(v) => onChange({ ...draft, branch: v ?? '' })}
          aria-label={`Branch for ${draft.alias}`}
          placeholder="Choose a branch…"
          className="w-52 font-mono"
          items={branchItems}
        />
      )}
    </>
  );
}

/** Uncommitted-changes warning and the draft's own error, under the controls. */
function RowNotes({ draft, facts, className }: { draft: DraftSource; facts: SourceFacts; className?: string }) {
  const notes: ReactNode[] = [];
  if (draft.branchMode !== 'current' && facts.dirty && draft.mode === 'in-place') {
    notes.push(
      <p key="dirty" className="text-small text-warn">
        {draft.alias} has uncommitted changes — the branch switch will be refused until it is committed or stashed.
      </p>,
    );
  }
  if (draft.meta.error) {
    notes.push(
      <p key="error" className="text-small text-err">
        {draft.meta.error}
      </p>,
    );
  }
  return notes.length > 0 ? <div className={cn('flex flex-col gap-1', className)}>{notes}</div> : null;
}

function DirtyMark({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <Tooltip content="Files here have changes that are not committed yet. A branch switch in place is refused until they are committed or stashed.">
      <Badge tone="warn" icon="warning" data-testid="source-dirty">
        uncommitted
      </Badge>
    </Tooltip>
  );
}

function WorkingDirectoryBadge() {
  return (
    <Badge icon="home" title="The agent's working directory">
      Working directory
    </Badge>
  );
}

// ── The chat folder (D-141) ──────────────────────────────────

/**
 * The folder this chat owns, once the agent has made files in it. Kept beside
 * the user's sources by default; removing it says what will be deleted.
 */
function ChatFolderRow({ draft, disabled, isPrimary, onRemove, onMakePrimary }: SourceRowProps) {
  const files = draft.meta.files ?? 0;
  return (
    <div className="flex items-center gap-2.5 py-2.5 pr-2.5 pl-3" data-testid="source-chat-folder">
      <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" />
      <div className="flex min-w-0 flex-col">
        <span className="text-ui font-medium text-fg">Chat folder</span>
        <span className="text-small text-fg-3">
          {files >= 1000 ? '1000+' : files} file{files === 1 ? '' : 's'} the agent made in this chat
        </span>
      </div>
      {isPrimary ? (
        <WorkingDirectoryBadge />
      ) : (
        <Button variant="ghost" size="sm" icon="home" disabled={disabled} onClick={onMakePrimary} title="The agent's working directory">
          Make working directory
        </Button>
      )}
      <span className="flex-1" />
      <IconButton icon="trash" size="sm" label="Remove the chat folder" tooltip="Remove — deletes its files" disabled={disabled} onClick={onRemove} />
    </div>
  );
}

// ── Compact row (NewChat) ─────────────────────────────────────

function CompactSourceRow(props: SourceRowProps) {
  const { draft, disabled, isPrimary, onRemove } = props;
  const facts = useSourceFacts(draft, props.projectId);
  return (
    <div className="flex flex-col gap-1.5 py-2.5 pr-2.5 pl-3">
      <div className="flex items-center gap-2.5">
        {/* Unticking removes the source — for a codebase it returns to the
            "Not included" rows; a folder simply leaves the list. */}
        <Checkbox checked disabled={disabled} onCheckedChange={onRemove} aria-label={`Include ${draft.alias}`} />
        {draft.kind === 'folder' ? <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" /> : null}
        <span className="min-w-0 truncate font-mono text-ui font-medium text-fg" title={draft.meta.origin ?? draft.path}>
          {draft.alias}
        </span>
        {isPrimary ? <WorkingDirectoryBadge /> : null}
        <DirtyMark dirty={facts.dirty} />
        <span className="flex-1" />
        {/* A folder that is not a repository can only be edited in place. */}
        {draft.meta.isGit ? <ModeControl {...props} /> : null}
      </div>
      {/* A plain folder has no branches to choose (the server refuses them). */}
      {draft.meta.isGit ? (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <BranchControls {...props} facts={facts} />
        </div>
      ) : null}
      <RowNotes draft={draft} facts={facts} className="pl-6" />
    </div>
  );
}

// ── Full list (ChatCreate, Edit sources…) — D-167 ──────────────

/** `https://github.com/acme/web.git` → `github.com/acme/web`; a path keeps its tail. */
function shortOrigin(origin: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(origin) || /^git@/i.test(origin)) {
    return origin
      .replace(/^[a-z][a-z0-9+.-]*:\/\/([^@/]+@)?/i, '')
      .replace(/^git@([^:]+):/i, '$1/')
      .replace(/\.git$/i, '');
  }
  return pathTail(origin, 48);
}

/** The list header's project switcher: the active project's name as a ghost menu button. */
function ProjectSwitcher({
  projects,
  value,
  disabled,
  onChange,
}: {
  projects: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const named = projects.filter((p) => p.value !== NO_PROJECT);
  const current = named.find((p) => p.value === value)?.label ?? 'No project';
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button variant="ghost" size="sm" icon="projects" trailingIcon="chevron-down" disabled={disabled} className="font-semibold text-fg">
            {current}
          </Button>
        }
        aria-label={`Project: ${current}`}
      />
      <Menu.Popup>
        <Menu.RadioGroup value={value} onValueChange={(v) => onChange(String(v))}>
          {named.map((p) => (
            <Menu.RadioItem key={p.value} value={p.value}>
              {p.label}
            </Menu.RadioItem>
          ))}
          {named.length > 0 ? <Menu.Separator /> : null}
          <Menu.RadioItem value={NO_PROJECT}>No project · local folders only</Menu.RadioItem>
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Root>
  );
}

const MODE_DESCRIPTION: Record<SourceMode, string> = {
  worktree: 'A separate copy on its own branch. Your checkout is not touched.',
  'in-place': 'Edits your checkout directly, on the branch it is on.',
};

/** "Worktree ▾" — where the agent works, as a token in the source's sentence. */
function ModeToken({ draft, disabled, onChange }: Pick<SourceRowProps, 'draft' | 'disabled' | 'onChange'>) {
  const setMode = (mode: SourceMode) => {
    // A worktree always lands on a branch of its own (see ModeControl).
    const branchMode: BranchMode = mode === 'worktree' && draft.branchMode === 'current' ? 'new' : draft.branchMode;
    onChange({ ...draft, mode, branchMode });
  };
  const option = (mode: SourceMode, label: string, allowed: boolean, reason?: string) => (
    <Menu.RadioItem value={mode} disabled={!allowed} description={allowed ? MODE_DESCRIPTION[mode] : (reason ?? MODE_DESCRIPTION[mode])} descriptionFont="sans">
      {label}
    </Menu.RadioItem>
  );
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        render={<Chip dropdown>{draft.mode === 'worktree' ? 'Worktree' : 'In place'}</Chip>}
        aria-label={`Where the agent works: ${draft.mode === 'worktree' ? 'Worktree' : 'In place'}`}
      />
      <Menu.Popup className="w-80">
        <Menu.RadioGroup value={draft.mode} onValueChange={(v) => setMode(v as SourceMode)}>
          {option('worktree', 'Worktree', draft.meta.allowWorktree, draft.meta.allowWorktreeReason)}
          {option('in-place', 'In place', draft.meta.allowInPlace, draft.meta.allowInPlaceReason)}
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Root>
  );
}

/** "⑂ branch ▾" — which branch, its name and where it starts, in one small popover. */
function BranchToken({
  draft,
  chatName,
  disabled,
  onChange,
  facts,
}: Pick<SourceRowProps, 'draft' | 'chatName' | 'disabled' | 'onChange'> & { facts: SourceFacts }) {
  const { branches, currentBranch } = facts;
  const branchItems = branches.map((b) => ({ value: b, label: b }));
  const missing = draft.branchMode === 'existing' && !draft.branch;
  const label =
    draft.branchMode === 'current' ? (currentBranch ?? 'current branch') : missing ? 'choose a branch' : (effectiveBranch(draft, chatName) ?? '');
  return (
    <PopoverRoot>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Chip mono icon="branch" dropdown aria-haspopup="dialog" className={cn('max-w-full', missing && 'text-warn')}>
            {label}
          </Chip>
        }
        aria-label={`Branch for ${draft.alias}: ${label}`}
      />
      <PopoverPopup className="flex w-80 flex-col gap-3 p-3" aria-label={`Branch for ${draft.alias}`}>
        <SegmentedControl<BranchMode>
          label={`Branch for ${draft.alias}`}
          fullWidth
          value={draft.branchMode}
          onValueChange={(branchMode) => onChange({ ...draft, branchMode })}
          items={[
            segItem<BranchMode>('new', 'New branch', disabled),
            segItem<BranchMode>('existing', 'Existing', disabled, branches.length === 0, 'No branches were found in this repository.'),
            // A worktree with no branch of its own would fight the checkout it was cut from.
            ...(draft.mode === 'in-place' ? [segItem<BranchMode>('current', 'Current', disabled)] : []),
          ]}
        />
        {draft.branchMode === 'new' ? (
          <>
            <Field label="Name">
              <Input
                size="sm"
                mono
                value={draft.newBranch}
                disabled={disabled}
                onChange={(e) => onChange({ ...draft, newBranch: e.target.value })}
                placeholder={defaultNewBranch(chatName)}
              />
            </Field>
            <Field label="Start from">
              <Select
                size="sm"
                value={draft.baseRef || CURRENT_HEAD}
                disabled={disabled}
                onValueChange={(v) => onChange({ ...draft, baseRef: !v || v === CURRENT_HEAD ? '' : v })}
                className="w-full font-mono"
                items={[{ value: CURRENT_HEAD, label: currentBranch ? `Current (${currentBranch})` : 'Current HEAD' }, ...branchItems]}
              />
            </Field>
          </>
        ) : draft.branchMode === 'existing' ? (
          <Field label="Branch">
            <Select
              size="sm"
              value={draft.branch || null}
              disabled={disabled || branches.length === 0}
              onValueChange={(v) => onChange({ ...draft, branch: v ?? '' })}
              placeholder="Choose a branch…"
              className="w-full font-mono"
              items={branchItems}
            />
          </Field>
        ) : (
          <p className="text-small text-fg-3">The agent works on the branch that is checked out{currentBranch ? ` (${currentBranch})` : ''}.</p>
        )}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-small text-fg-3">
            {draft.branchMode === 'new' ? 'Created when you save.' : draft.branchMode === 'existing' ? 'Checked out when you save.' : ''}
          </span>
          <PopoverClose render={<Button size="sm">Done</Button>} />
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}

/** The source as one sentence whose parts are its controls: "[Worktree ▾] on new branch [⑂ x ▾] from develop". */
function SourceSentence(props: SourceRowProps & { facts: SourceFacts }) {
  const { draft, facts } = props;
  if (!draft.meta.isGit) {
    return <p className="pl-6 text-small text-fg-3">In place · not a git repository, so the agent edits the folder itself</p>;
  }
  const words = draft.branchMode === 'new' ? 'on new branch' : draft.branchMode === 'existing' ? 'on' : 'stays on';
  const base = draft.baseRef.trim() || facts.currentBranch;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-small text-fg-3" data-testid="source-setup">
      <ModeToken {...props} />
      <span>{words}</span>
      <BranchToken {...props} />
      {draft.branchMode === 'new' && base ? (
        <>
          <span>from</span>
          <span className="font-mono text-fg-2">{base}</span>
        </>
      ) : null}
      {draft.mode === 'in-place' ? <span>· edits your checkout directly</span> : null}
    </div>
  );
}

/**
 * One included codebase or folder (D-167): tick to keep it, its name and
 * origin, its state, a ⋯ menu for the rare actions, then the sentence.
 */
function SourceRow(props: SourceRowProps) {
  const { draft, total, disabled, live, isPrimary, onChange, onRemove, onMakePrimary } = props;
  const facts = useSourceFacts(draft, props.projectId);
  const { nested } = facts;
  const origin = draft.meta.origin ?? draft.path;
  const [renaming, setRenaming] = useState(false);

  // What the server has now, to tell a rebuild from a no-op (live chats only).
  const saved = useRef(draftSetupKey(draft));
  const rebuilt = live && draft.mode === 'worktree' && draftSetupKey(draft) !== saved.current;

  return (
    <div className="flex flex-col gap-2 py-2.5 pr-2 pl-3">
      <div className="flex min-h-control-sm min-w-0 items-center gap-2">
        {/* Unticking removes it: a codebase returns to the unticked rows, a folder leaves the list. */}
        <Checkbox checked disabled={disabled} onCheckedChange={onRemove} aria-label={`Include ${draft.alias}`} />
        {draft.kind === 'folder' ? <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" /> : null}
        {renaming ? (
          <Input
            size="sm"
            mono
            autoFocus
            value={draft.alias}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, alias: e.target.value })}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') setRenaming(false);
            }}
            aria-label={`Name for ${draft.meta.label}`}
            className="w-44"
          />
        ) : (
          <span className="shrink-0 font-mono text-ui font-medium text-fg" title="The folder name the agent sees">
            {draft.alias}
          </span>
        )}
        {origin ? (
          <span className="min-w-0 truncate font-mono text-micro text-fg-3" title={origin}>
            {shortOrigin(origin)}
          </span>
        ) : null}
        <span className="flex-1" />
        {/* With one source it is the working directory by definition; the badge only tells several apart. */}
        {isPrimary && total > 1 ? <WorkingDirectoryBadge /> : null}
        {nested.length > 0 && (
          <Tooltip content={`Nested repositories: ${nested.join(', ')}`}>
            <span className="shrink-0 text-small text-fg-3">
              {nested.length} nested {nested.length === 1 ? 'repo' : 'repos'}
            </span>
          </Tooltip>
        )}
        <DirtyMark dirty={facts.dirty} />
        <Menu.Root>
          <Menu.Trigger render={<IconButton icon="more" size="sm" label={`More for ${draft.alias}`} disabled={disabled} />} />
          <Menu.Popup align="end">
            <Menu.Item icon="edit" onClick={() => setRenaming(true)}>
              Rename…
            </Menu.Item>
            {total > 1 && !isPrimary ? (
              <Menu.Item icon="home" onClick={onMakePrimary}>
                Make working directory
              </Menu.Item>
            ) : null}
            {origin ? (
              <Menu.Item icon="copy" onClick={() => void navigator.clipboard?.writeText(origin).catch(() => undefined)}>
                Copy {draft.kind === 'folder' ? 'path' : 'location'}
              </Menu.Item>
            ) : null}
          </Menu.Popup>
        </Menu.Root>
      </div>

      <SourceSentence {...props} facts={facts} />

      {rebuilt && facts.dirty ? (
        <div className="ml-6 flex items-start gap-2 rounded-control bg-warn-bg px-2.5 py-1.5 text-small text-warn" data-testid="source-rebuild-dirty">
          <Icon concept="warning" size={14} className="mt-0.5 shrink-0" />
          <span>Saving rebuilds this worktree and discards its uncommitted changes. Commit them first, or press Cancel.</span>
        </div>
      ) : null}
      <RowNotes draft={draft} facts={facts} className="pl-6" />
    </div>
  );
}

/** The chat folder in the full list: ticked = kept (D-141). */
function ChatFolderListRow({ draft, total, disabled, isPrimary, onRemove, onMakePrimary }: SourceRowProps) {
  const files = draft.meta.files ?? 0;
  return (
    <div className="flex h-row items-center gap-2.5 pr-2 pl-3" data-testid="source-chat-folder">
      <Checkbox checked disabled={disabled} onCheckedChange={onRemove} aria-label="Keep the chat folder" />
      <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-ui font-medium text-fg">Chat folder</span>
      <span className="min-w-0 truncate text-small text-fg-3">
        {files >= 1000 ? '1000+' : files} file{files === 1 ? '' : 's'} the agent created
      </span>
      <span className="flex-1" />
      {isPrimary && total > 1 ? <WorkingDirectoryBadge /> : null}
      <span className="shrink-0 text-small text-fg-3">In place</span>
      {total > 1 && !isPrimary ? (
        <Menu.Root>
          <Menu.Trigger render={<IconButton icon="more" size="sm" label="More for the chat folder" disabled={disabled} />} />
          <Menu.Popup align="end">
            <Menu.Item icon="home" onClick={onMakePrimary}>
              Make working directory
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      ) : null}
    </div>
  );
}

/** The chat folder after it was unticked: saving deletes it; ticking keeps it again. */
function ChatFolderOption({ files, disabled, onKeep }: { files: number; disabled: boolean; onKeep: () => void }) {
  return (
    <div className="flex h-row items-center gap-2.5 pr-2.5 pl-3">
      <Checkbox checked={false} disabled={disabled} onCheckedChange={onKeep} aria-label="Keep the chat folder" />
      <Icon concept="folder-open" size={14} className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-ui text-fg-2">Chat folder</span>
      <span className="min-w-0 truncate text-small text-fg-3">
        {files >= 1000 ? '1000+' : files} file{files === 1 ? '' : 's'} the agent created
      </span>
      <span className="flex-1" />
      <span className="shrink-0 text-small text-warn">Deleted when you save</span>
    </div>
  );
}
