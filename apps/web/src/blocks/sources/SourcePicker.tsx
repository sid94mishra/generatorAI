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

  const move = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (target < 0 || target >= drafts.length) return;
      const copy = [...drafts];
      const [item] = copy.splice(index, 1);
      if (item) copy.splice(target, 0, item);
      onChange(copy);
    },
    [drafts, onChange],
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
    onMove: (delta) => move(index, delta),
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
  const Row = compact ? CompactSourceRow : SourceRow;
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
  onMove: (delta: number) => void;
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

// ── Full row (ChatCreate, Edit sources…) ──────────────────────

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

/** The fields that decide how a source is materialised; a kept mount changing any of them is rebuilt. */
function setupOf(d: DraftSource): string {
  return [d.alias, d.mode, d.branchMode, d.newBranch.trim(), d.branch, d.baseRef].join('\u0000');
}

const Mono = ({ children }: { children: ReactNode }) => <span className="font-mono text-fg">{children}</span>;

/** One line in words: how the agent gets this source and which branch it lands on. */
function SetupSummary({ draft, chatName, currentBranch }: { draft: DraftSource; chatName: string; currentBranch: string | null }) {
  if (!draft.meta.isGit) return <>In place · not a git repository</>;
  const mode = draft.mode === 'worktree' ? 'Worktree' : 'In place';
  const base = draft.baseRef.trim() || currentBranch;
  if (draft.branchMode === 'new') {
    return (
      <>
        {mode} · new branch <Mono>{draft.newBranch.trim() || defaultNewBranch(chatName)}</Mono>
        {base ? (
          <>
            {' '}from <Mono>{base}</Mono>
          </>
        ) : null}
      </>
    );
  }
  if (draft.branchMode === 'existing') {
    return draft.branch ? (
      <>
        {mode} · on <Mono>{draft.branch}</Mono>
      </>
    ) : (
      <>
        {mode} · <span className="text-warn">choose a branch</span>
      </>
    );
  }
  return currentBranch ? (
    <>
      {mode} · stays on <Mono>{currentBranch}</Mono>
    </>
  ) : (
    <>{mode} · current branch</>
  );
}

const MODE_HINT: Record<SourceMode, string> = {
  worktree: 'A separate checkout on its own branch. Your folder and its uncommitted files are not touched.',
  'in-place': 'The agent edits the folder itself, on the branch it has checked out.',
};

/**
 * One source: a header line (what it is, its state, a ⋯ menu for the rare
 * actions), one line saying how the agent gets it, and the setup controls
 * behind "Change" (D-166). Defaults are right for most chats, so the controls
 * stay folded until asked for — or until the source needs an answer.
 */
function SourceRow(props: SourceRowProps) {
  const { draft, index, total, chatName, disabled, live, isPrimary, onChange, onRemove, onMakePrimary, onMove } = props;
  const facts = useSourceFacts(draft, props.projectId);
  const { currentBranch, nested } = facts;
  const origin = draft.meta.origin ?? draft.path;

  const needsAnswer = draft.branchMode === 'existing' && !draft.branch;
  const [open, setOpen] = useState(needsAnswer);
  const [renaming, setRenaming] = useState(false);
  const shown = open || needsAnswer;

  // What the server has now, to tell a rebuild from a no-op (live chats only).
  const saved = useRef(setupOf(draft));
  const rebuilt = live && draft.mode === 'worktree' && setupOf(draft) !== saved.current;

  const copyPath = useCallback(() => {
    if (origin) void navigator.clipboard?.writeText(origin).catch(() => undefined);
  }, [origin]);

  return (
    <div className="flex flex-col gap-1 py-2.5 pr-2 pl-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon concept={draft.meta.isGit ? 'branch' : 'folder-open'} size={14} className="shrink-0 text-fg-3" />
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
          <span className="min-w-0 truncate font-mono text-small text-fg-3" title={origin}>
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
              Rename
            </Menu.Item>
            {total > 1 && !isPrimary ? (
              <Menu.Item icon="home" onClick={onMakePrimary}>
                Make working directory
              </Menu.Item>
            ) : null}
            {total > 1 ? (
              <>
                <Menu.Item icon="chevron-up" disabled={index === 0} onClick={() => onMove(-1)}>
                  Move up
                </Menu.Item>
                <Menu.Item icon="chevron-down" disabled={index === total - 1} onClick={() => onMove(1)}>
                  Move down
                </Menu.Item>
              </>
            ) : null}
            {origin ? (
              <Menu.Item icon="copy" onClick={copyPath}>
                Copy {draft.kind === 'folder' ? 'path' : 'location'}
              </Menu.Item>
            ) : null}
            <Menu.Separator />
            <Menu.Item icon="trash" danger onClick={onRemove}>
              Remove
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>

      <div className="flex min-w-0 items-center gap-2 pl-6">
        <p className="min-w-0 flex-1 truncate text-small text-fg-2" data-testid="source-setup">
          <SetupSummary draft={draft} chatName={chatName} currentBranch={currentBranch} />
        </p>
        {draft.meta.isGit && !needsAnswer ? (
          <Button variant="ghost" size="sm" aria-expanded={shown} disabled={disabled} onClick={() => setOpen((v) => !v)}>
            {shown ? 'Done' : 'Change'}
          </Button>
        ) : null}
      </div>

      {draft.meta.isGit && shown ? (
        <div className="mt-2 flex flex-col gap-3 pl-6">
          <div className="flex flex-col items-start gap-1.5">
            <span className="text-small font-medium text-fg-2">Where the agent works</span>
            <ModeControl {...props} />
            <span className="text-small text-fg-3">{MODE_HINT[draft.mode]}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-small font-medium text-fg-2">Branch</span>
            <div className="flex flex-wrap items-center gap-2">
              <BranchControls {...props} facts={facts} />
            </div>
          </div>
        </div>
      ) : null}

      {rebuilt && facts.dirty ? (
        <Callout tone="warn" className="mt-2 ml-6" data-testid="source-rebuild-dirty">
          Saving rebuilds the {draft.alias} worktree, and its uncommitted changes are discarded. Commit them first, or press Cancel.
        </Callout>
      ) : rebuilt ? (
        <p className="pl-6 text-small text-fg-3">Saving rebuilds the {draft.alias} worktree with this setup.</p>
      ) : null}
      <RowNotes draft={draft} facts={facts} className="pl-6" />
    </div>
  );
}
