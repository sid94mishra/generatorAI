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
  basename,
  defaultNewBranch,
  draftFromCodebase,
  draftFromFolder,
  plainSetup,
  type BranchMode,
  type CodebaseLike,
  type DraftSource,
  type SourceMode,
  autoIncludedCodebase,
  draftFromChatFolder,
  draftSetupKey,
  effectiveBranch,
  effectiveRepoBranch,
  setAllRepos,
  setRepoSetup,
  setSourceMode,
  withRepos,
  type DraftRepo,
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
  /** The chat being edited, when there is one (see `SourceRowProps.chatId`). */
  chatId?: string;
  /**
   * The chat has started: its working directory is fixed (folder, mode, branch, the repositories inside).
   * Other sources stay editable; `onStartNewChat` offers working somewhere else.
   */
  lockPrimary?: boolean;
  /** The chat has started in its own empty folder: it may choose a working directory once. */
  chooseOnce?: boolean;
  onStartNewChat?: () => void;
}

/** Base UI Select treats `''` poorly as a value; these stand in for "none". */
const NO_PROJECT = '__no-project__';
const CURRENT_HEAD = '__current-head__';

const EMPTY_HINT = 'Nothing linked yet. The agent starts in an empty folder of its own — add a folder to work on your files.';
const EMPTY_HINT_WITH_CODEBASES = 'Tick a codebase or add a folder. With nothing ticked, the agent starts in an empty folder of its own.';

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
  chatId,
  lockPrimary = false,
  chooseOnce = false,
  onStartNewChat,
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

  // A chat works with ONE project. Switching project drops the codebases of the one it left (folders stay), and
  // says so — keeping them ticked only for the server to refuse the chat read as a broken form.
  // D-108: then a project's only codebase is included (once per project, so unticking sticks).
  const [dropped, setDropped] = useState<string[]>([]);
  const autoIncludedFor = useRef<string | null>(null);
  useEffect(() => {
    if (projectId && !codebases) return;
    const valid = new Set((codebases ?? []).map((cb) => cb.id));
    const stale = drafts.filter((d) => d.kind === 'codebase' && !valid.has(d.codebaseId ?? ''));
    let next = drafts;
    if (stale.length > 0) {
      next = drafts.filter((d) => !stale.includes(d));
      setDropped(stale.map((d) => d.alias));
    } else {
      setDropped([]);
    }
    if (projectId && codebases && autoIncludedFor.current !== projectId) {
      autoIncludedFor.current = projectId;
      const only = autoIncludedCodebase(codebases, next);
      if (only) next = [...next, draftFromCodebase(toCodebaseLike(only), next.map((d) => d.alias))];
    }
    if (next !== drafts) {
      onChange(next);
      if (!next.some((d) => d.alias === effectivePrimary)) onPrimaryChange(next[0]?.alias ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconciled when the project (and so its codebases) changes
  }, [projectId, codebases]);

  /**
   * Add a folder, resolving its git facts FIRST.
   *
   * Doing it here rather than in an effect on the row keeps `meta` the single
   * authority for what the source can do: validation and the mode toggle read
   * the same object, so a plain folder can never be submitted as a worktree
   * because the answer had not arrived yet.
   */
  // A folder already in the list, or inside / around one, is refused as it is picked — the server refuses it
  // too, but only after Start.
  const [pickNote, setPickNote] = useState<string | null>(null);
  const addFolder = useCallback(
    async (path: string) => {
      if (atLimit) return;
      const clash = folderClash(path, drafts);
      setPickNote(clash);
      if (clash) return;
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

  const rowProps = (draft: DraftSource, index: number): SourceRowProps => {
    const isPrimary = draft.alias === effectivePrimary;
    const locked = lockPrimary && isPrimary;
    return {
      draft,
      index,
      total: drafts.length,
      chatName,
      projectId,
      disabled: disabled || locked,
      live,
      chatId,
      isPrimary,
      locked,
      // A started chat keeps its working directory: no other source can take its place.
      canMakePrimary: !lockPrimary,
      onChange: (next) => replaceAt(index, next),
      onRemove: () => removeAt(index),
      onMakePrimary: () => onPrimaryChange(draft.alias),
    };
  };

  // The working directory first, under its own heading; everything else is "also available".
  const ordered = drafts.map((draft, index) => ({ draft, index }));
  const primaryEntry = ordered.find((e) => e.draft.alias === effectivePrimary);
  const others = ordered.filter((e) => e !== primaryEntry);
  const lockNote = lockPrimary ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-fg-3" data-testid="source-workdir-locked">
      <Icon concept="lock" size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">Fixed once the chat has started — earlier turns and their changes refer to it.</span>
      {onStartNewChat ? (
        <Button variant="ghost" size="sm" icon="plus" onClick={onStartNewChat} data-testid="source-start-new-chat">
          New chat somewhere else
        </Button>
      ) : null}
    </div>
  ) : chooseOnce ? (
    <p className="flex items-start gap-2 text-small text-fg-3" data-testid="source-choose-once">
      <Icon concept="info" size={14} className="mt-0.5 shrink-0" />
      <span>This chat started in an empty folder of its own. You can choose its working directory once; after that it stays fixed.</span>
    </p>
  ) : null;

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
      {pickNote && (
        <p className="text-small text-warn" role="status" data-testid="sources-pick-note">
          {pickNote}
        </p>
      )}
      {dropped.length > 0 && (
        <p className="text-small text-fg-3" data-testid="sources-dropped-codebases">
          Removed {dropped.join(', ')}: a chat works with one project, and {dropped.length === 1 ? 'it belongs' : 'they belong'} to
          another.
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
          <SectionHeading title="Working directory" hint="Where the agent works" />
          {primaryEntry ? (
            <li key={primaryEntry.draft.key} className="border-b border-line-soft">
              {primaryEntry.draft.kind === 'chat-folder' ? (
                <ChatFolderListRow {...rowProps(primaryEntry.draft, primaryEntry.index)} />
              ) : (
                <SourceRow {...rowProps(primaryEntry.draft, primaryEntry.index)} />
              )}
            </li>
          ) : (
            <li className="border-b border-line-soft px-3 py-2.5 text-small text-fg-3" data-testid="source-workdir-empty">
              {notIncluded.length > 0 ? EMPTY_HINT_WITH_CODEBASES : EMPTY_HINT}
            </li>
          )}
          {lockNote ? <li className="border-b border-line-soft px-3 py-2">{lockNote}</li> : null}
          <SectionHeading title="Also available to the agent" hint="It can read and edit these too" />
          {others.map(({ draft, index }) => (
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
          {others.length === 0 && notIncluded.length === 0 && !keepChatFolder && (
            <li className="px-3 py-2.5 text-small text-fg-3">Nothing else yet — tick a codebase or add a local folder.</li>
          )}
        </ul>
        {footer}
      </div>
    );
  }

  const Row = CompactSourceRow;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Project" optional hint={projectId ? undefined : 'Pick one to work on its codebases. Your own folders need none.'}>
        {projectSelect}
      </Field>
      <div className="flex flex-col gap-2">
        {codebaseStatus}
        <ul className="overflow-hidden rounded-card border border-line" data-testid="source-list">
          <SectionHeading title="Working directory" hint="Where the agent works" strong />
          {primaryEntry ? (
            <li key={primaryEntry.draft.key} className="border-b border-line">
              {primaryEntry.draft.kind === 'chat-folder' ? (
                <ChatFolderRow {...rowProps(primaryEntry.draft, primaryEntry.index)} />
              ) : (
                <Row {...rowProps(primaryEntry.draft, primaryEntry.index)} />
              )}
            </li>
          ) : (
            <li className="border-b border-line px-3 py-2.5 text-small text-fg-3" data-testid="source-workdir-empty">
              {notIncluded.length > 0 ? EMPTY_HINT_WITH_CODEBASES : EMPTY_HINT}
            </li>
          )}
          {lockNote ? <li className="border-b border-line px-3 py-2">{lockNote}</li> : null}
          <SectionHeading title="Also available to the agent" hint="It can read and edit these too" strong />
          {others.map(({ draft, index }) => (
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

// ── Section heading inside the list ───────────────────────────

/** "Working directory" / "Also available to the agent": a quiet heading row of the one list. */
function SectionHeading({ title, hint, strong = false }: { title: string; hint: string; strong?: boolean }) {
  return (
    <li className={cn('flex items-baseline gap-2 border-b px-3 pt-2 pb-1.5', strong ? 'border-line' : 'border-line-soft')} role="presentation">
      <span className="shrink-0 text-small font-medium text-fg-2">{title}</span>
      <span className="truncate text-small text-fg-3">{hint}</span>
    </li>
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
  /** The chat being edited ("Edit sources"), left out of "also edited in place by". */
  chatId?: string | undefined;
  isPrimary: boolean;
  /** The working directory of a started chat: shown, not editable. */
  locked?: boolean;
  /** Whether "Make working directory" is offered (not once the chat has started). */
  canMakePrimary?: boolean;
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
  // A local codebase is a folder on this machine too: its repositories inside are read the same way.
  const localPath = draft.kind === 'folder' ? draft.path : draft.kind === 'codebase' && draft.meta.origin && !/^[a-z][a-z0-9+.-]*:\/\/|^git@/i.test(draft.meta.origin) ? draft.meta.origin : undefined;
  const folderInfo = useFsGitInfo(localPath);

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
    usedInPlaceBy: folderInfo.data?.usedInPlaceBy ?? [],
    repoRoot: folderInfo.data?.repoRoot ?? draft.meta.repoRoot,
    loaded: !!folderInfo.data,
  };
}

/**
 * Keep the draft's repositories in step with the ones the folder holds (a codebase's are only known once its
 * folder is read; a folder may have gained one). Kept repositories keep their setup.
 */
function useRepoSync(draft: DraftSource, facts: SourceFacts, onChange: (next: DraftSource) => void) {
  const nestedKey = facts.nested.join('\u0000');
  useEffect(() => {
    if (!facts.loaded || draft.kind === 'chat-folder') return;
    const have = (draft.repos ?? []).map((r) => r.path).join('\u0000');
    if (have === nestedKey) return;
    let next = withRepos(draft, facts.nested);
    // A plain folder that holds repositories can be a separate copy of itself.
    if (!draft.meta.isGit && facts.nested.length > 0 && !next.meta.allowWorktree) {
      next = { ...next, meta: { ...next.meta, allowWorktree: true } };
    }
    onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconciled when the folder's repositories change
  }, [nestedKey, facts.loaded]);
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
  const setMode = (mode: SourceMode) => onChange(setSourceMode(draft, mode));
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
function RowNotes({ draft, facts, chatId, className }: { draft: DraftSource; facts: SourceFacts; chatId?: string | undefined; className?: string }) {
  const notes: ReactNode[] = [];
  const others = facts.usedInPlaceBy.filter((c) => c.id !== chatId);
  if (draft.mode === 'in-place' && others.length > 0) {
    notes.push(
      <p key="shared" className="text-small text-warn" data-testid="source-shared-in-place">
        Also edited in place by {others.map((c) => `“${c.name}”`).join(', ')}. Two agents in one folder can overwrite each
        other’s changes{draft.meta.isGit ? ' — a worktree keeps this chat apart' : ''}.
      </p>,
    );
  }
  if (draft.branchMode !== 'current' && facts.dirty && draft.mode === 'in-place') {
    notes.push(
      <p key="dirty" className="text-small text-warn">
        {draft.alias} has uncommitted changes — the branch switch will be refused until it is committed or stashed.
      </p>,
    );
  }
  if (facts.repoRoot) {
    notes.push(
      <p key="in-repo" className="text-small text-fg-3" data-testid="source-in-repo">
        Part of the {basename(facts.repoRoot)} repository: the agent starts in this folder, and its changes are tracked and committed with the
        whole repository.
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
function ChatFolderRow({ draft, disabled, isPrimary, canMakePrimary = true, onRemove, onMakePrimary }: SourceRowProps) {
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
      ) : canMakePrimary ? (
        <Button variant="ghost" size="sm" icon="home" disabled={disabled} onClick={onMakePrimary} title="The agent's working directory">
          Make working directory
        </Button>
      ) : null}
      <span className="flex-1" />
      <IconButton icon="trash" size="sm" label="Remove the chat folder" tooltip="Remove — deletes its files" disabled={disabled} onClick={onRemove} />
    </div>
  );
}

// ── Compact row (NewChat) ─────────────────────────────────────

function CompactSourceRow(props: SourceRowProps) {
  const { draft, total, chatName, disabled, isPrimary, locked = false, canMakePrimary = true, onRemove, onMakePrimary } = props;
  const facts = useSourceFacts(draft, props.projectId);
  useRepoSync(draft, facts, props.onChange);
  // The defaults fit most people (your folder as it is; a codebase on a branch of its own), so the setup reads
  // as one sentence and its controls wait behind "Change". A row that needs an answer opens by itself.
  const needsAnswer = !!draft.meta.error || (draft.branchMode === 'existing' && !draft.branch);
  const [open, setOpen] = useState(false);
  const expanded = open || needsAnswer;
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
        {/* With one source there is nothing to choose between: the badge would only add a word to learn. */}
        {isPrimary && total > 1 ? <WorkingDirectoryBadge /> : null}
        <DirtyMark dirty={facts.dirty} />
        <span className="flex-1" />
        {!isPrimary && total > 1 && canMakePrimary ? (
          <Button variant="ghost" size="sm" icon="home" disabled={disabled} onClick={onMakePrimary} data-testid="source-make-primary">
            Make working directory
          </Button>
        ) : null}
        {(draft.meta.isGit || draft.meta.allowWorktree) && !needsAnswer && !locked ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-expanded={expanded}
            onClick={() => setOpen((v) => !v)}
            aria-label={`${expanded ? 'Done changing' : 'Change'} how the agent works in ${draft.alias}`}
            data-testid="source-change"
          >
            {expanded ? 'Done' : 'Change'}
          </Button>
        ) : null}
      </div>
      <p className="pl-6 text-small text-fg-3" data-testid="source-setup-sentence">
        {plainSetup(draft, chatName, facts.currentBranch)}
      </p>
      {expanded && (draft.meta.isGit || draft.meta.allowWorktree) ? (
        <div className="flex flex-col gap-2 pl-6">
          <ModeControl {...props} />
          {draft.meta.isGit ? (
            <div className="flex flex-wrap items-center gap-2">
              <BranchControls {...props} facts={facts} />
            </div>
          ) : null}
          {draft.mode === 'in-place' && draft.branchMode !== 'current' ? (
            <p className="flex items-start gap-2 text-small text-warn" data-testid="source-branch-in-place-warning">
              <Icon concept="warning" size={14} className="mt-0.5 shrink-0" />
              <span>Switches the branch of your own folder, which your editor and terminals also see.</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {draft.repos?.length ? <RepoList draft={draft} chatName={chatName} disabled={disabled} onChange={props.onChange} /> : null}
      <RowNotes draft={draft} facts={facts} chatId={props.chatId} className="pl-6" />
    </div>
  );
}

// ── Repositories inside a source ──────────────────────────────

/** `root` + `rel` on the separator `root` uses. */
function joinPath(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}

/**
 * The repositories inside a source, each with its own setup: as it is (in place, on its current branch or
 * another), or a worktree on a branch of its own in a separate copy of the source. "Set all" does every
 * repository at once.
 */
function RepoList({ draft, chatName, disabled, onChange }: { draft: DraftSource; chatName: string; disabled: boolean; onChange: (next: DraftSource) => void }) {
  const repos = draft.repos ?? [];
  const root = draft.kind === 'folder' ? draft.path : draft.meta.origin;
  return (
    <div className="ml-6 flex flex-col gap-1 rounded-control border border-line-soft px-2.5 py-2" data-testid="source-repos" aria-label={`Repositories inside ${draft.alias}`}>
      <div className="flex items-center gap-2">
        <span className="text-small font-medium text-fg-2">
          {repos.length} {repos.length === 1 ? 'repository' : 'repositories'} inside · each committed on its own
        </span>
        <span className="flex-1" />
        {repos.length > 1 ? (
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button variant="ghost" size="sm" trailingIcon="chevron-down" disabled={disabled} data-testid="source-repos-set-all">
                  Set all
                </Button>
              }
            />
            <Menu.Popup align="end" className="w-80">
              <Menu.Item onClick={() => onChange(setAllRepos(draft, 'as-is'))} description="Each stays on its current branch, in your folder." descriptionFont="sans">
                Use them as they are
              </Menu.Item>
              <Menu.Item
                onClick={() => onChange(setAllRepos(draft, 'separate'))}
                description="A worktree of each on a new branch. Your checkouts are not touched."
                descriptionFont="sans"
              >
                A separate copy of each
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
        ) : null}
      </div>
      {repos.map((repo) => (
        <RepoRow key={repo.path} draft={draft} repo={repo} root={root} chatName={chatName} disabled={disabled} onChange={onChange} />
      ))}
    </div>
  );
}

function RepoRow({
  draft,
  repo,
  root,
  chatName,
  disabled,
  onChange,
}: {
  draft: DraftSource;
  repo: DraftRepo;
  root: string | undefined;
  chatName: string;
  disabled: boolean;
  onChange: (next: DraftSource) => void;
}) {
  const dir = root ? joinPath(root, repo.path) : undefined;
  const info = useFsGitInfo(dir);
  const currentBranch = info.data?.currentBranch ?? null;
  const branches = useMemo(() => (info.data?.branches ?? []).slice().sort((a, b) => a.localeCompare(b)), [info.data]);
  const facts: SourceFacts = {
    branches,
    dirty: info.data?.dirty ?? false,
    nested: [],
    currentBranch,
    usedInPlaceBy: [],
    repoRoot: undefined,
    loaded: !!info.data,
  };
  // The repository through the same tokens a source uses.
  const asSource: DraftSource = {
    key: `${draft.key}:${repo.path}`,
    kind: 'folder',
    ...(dir ? { path: dir } : {}),
    alias: repo.path,
    mode: repo.mode,
    branchMode: repo.branchMode,
    newBranch: repo.newBranch,
    branch: repo.branch,
    baseRef: repo.baseRef,
    meta: { label: repo.path, isGit: true, allowInPlace: true, allowWorktree: true, branches, ...(currentBranch ? { defaultBranch: currentBranch } : {}) },
  };
  const apply = (next: DraftSource) =>
    onChange(
      setRepoSetup(draft, repo.path, {
        path: repo.path,
        mode: next.mode,
        branchMode: next.branchMode,
        newBranch: next.newBranch,
        branch: next.branch,
        baseRef: next.baseRef,
      }),
    );
  const words = repo.branchMode === 'new' ? 'on new branch' : repo.branchMode === 'existing' ? 'on' : 'stays on';
  const ends = effectiveRepoBranch(repo, chatName);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-fg-3" data-testid="source-repo-row" data-repo={repo.path}>
      <Icon concept="branch" size={14} className="shrink-0" />
      <span className="mr-1 shrink-0 font-mono text-ui text-fg" title={dir}>
        {repo.path}
      </span>
      <ModeToken draft={asSource} disabled={disabled} onChange={apply} />
      <span>{words}</span>
      <BranchToken draft={asSource} chatName={chatName} disabled={disabled} onChange={apply} facts={facts} />
      {repo.branchMode === 'new' && (repo.baseRef.trim() || currentBranch) ? (
        <>
          <span>from</span>
          <span className="font-mono text-fg-2">{repo.baseRef.trim() || currentBranch}</span>
        </>
      ) : null}
      <DirtyMark dirty={facts.dirty && repo.mode === 'in-place' && !!ends && ends !== currentBranch} />
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

/** A plain folder's separate copy is no worktree of its own: its repositories are. */
function modeLabel(draft: DraftSource): string {
  if (draft.mode === 'in-place') return 'In place';
  return draft.meta.isGit ? 'Worktree' : 'Separate copy';
}

/** "Worktree ▾" — where the agent works, as a token in the source's sentence. */
function ModeToken({ draft, disabled, onChange }: Pick<SourceRowProps, 'draft' | 'disabled' | 'onChange'>) {
  const setMode = (mode: SourceMode) => onChange(setSourceMode(draft, mode));
  const option = (mode: SourceMode, label: string, allowed: boolean, reason?: string) => (
    <Menu.RadioItem value={mode} disabled={!allowed} description={allowed ? MODE_DESCRIPTION[mode] : (reason ?? MODE_DESCRIPTION[mode])} descriptionFont="sans">
      {label}
    </Menu.RadioItem>
  );
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        render={<Chip dropdown>{modeLabel(draft)}</Chip>}
        aria-label={`Where the agent works in ${draft.alias}: ${modeLabel(draft)}`}
      />
      <Menu.Popup className="w-80">
        <Menu.RadioGroup value={draft.mode} onValueChange={(v) => setMode(v as SourceMode)}>
          {option('worktree', draft.meta.isGit ? 'Worktree' : 'Separate copy', draft.meta.allowWorktree, draft.meta.allowWorktreeReason)}
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
        {draft.mode === 'in-place' && draft.branchMode !== 'current' ? (
          // In place there is no copy: the branch moves in the user's own checkout (refused while it is dirty).
          <p className="flex items-start gap-2 text-small text-warn" data-testid="source-branch-in-place-warning">
            <Icon concept="warning" size={14} className="mt-0.5 shrink-0" />
            <span>Switches the branch of your own folder, which your editor and terminals also see. Refused while it has uncommitted changes.</span>
          </p>
        ) : null}
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
    if (!draft.meta.allowWorktree) {
      return <p className="pl-6 text-small text-fg-3">In place · not a git repository, so the agent edits the folder itself</p>;
    }
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-small text-fg-3" data-testid="source-setup">
        <ModeToken {...props} />
        <span>
          {draft.mode === 'worktree'
            ? '· its files are copied, your folder stays as it is'
            : '· not a git repository itself, so the agent edits the folder directly'}
        </span>
      </div>
    );
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
  const { draft, total, disabled, live, isPrimary, canMakePrimary = true, onChange, onRemove, onMakePrimary } = props;
  const facts = useSourceFacts(draft, props.projectId);
  useRepoSync(draft, facts, onChange);
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
        {nested.length > 0 && !draft.repos?.length && (
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
            {total > 1 && !isPrimary && canMakePrimary ? (
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
      {draft.repos?.length ? <RepoList draft={draft} chatName={props.chatName} disabled={disabled} onChange={onChange} /> : null}

      {rebuilt && facts.dirty ? (
        <div className="ml-6 flex items-start gap-2 rounded-control bg-warn-bg px-2.5 py-1.5 text-small text-warn" data-testid="source-rebuild-dirty">
          <Icon concept="warning" size={14} className="mt-0.5 shrink-0" />
          <span>Saving rebuilds this worktree and discards its uncommitted changes. Commit them first, or press Cancel.</span>
        </div>
      ) : null}
      <RowNotes draft={draft} facts={facts} chatId={props.chatId} className="pl-6" />
    </div>
  );
}

/** The chat folder in the full list: ticked = kept (D-141). */
function ChatFolderListRow({ draft, total, disabled, isPrimary, canMakePrimary = true, onRemove, onMakePrimary }: SourceRowProps) {
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
      {total > 1 && !isPrimary && canMakePrimary ? (
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

/** Why `picked` cannot join `drafts` (already there, or inside / around a folder that is), or null. */
function folderClash(picked: string, drafts: readonly DraftSource[]): string | null {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  const sep = (p: string) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
  const target = norm(picked);
  for (const d of drafts) {
    if (d.kind !== 'folder' || !d.path) continue;
    const other = norm(d.path);
    if (target === other) return `${basename(target)} is already in this chat.`;
    if (target.startsWith(other + sep(other))) return `${basename(target)} is inside ${d.alias}, which is already a source.`;
    if (other.startsWith(target + sep(target))) return `${basename(target)} contains ${d.alias}, which is already a source.`;
  }
  return null;
}
