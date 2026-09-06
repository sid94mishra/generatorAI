// ────────────────────────────────────────────────────────────────
// SourcePicker — "what should this chat work on?"
// ────────────────────────────────────────────────────────────────
//
// One editor, two hosts: the new-chat dialog and "Edit sources…" on a live
// chat. Both produce the same `ChatSourceSpec[]` + primary alias, so the
// rules (which modes a source supports, what a new branch is called, which
// mount is the agent's cwd) are defined once.
//
// The list is ordered and the first entry is the agent's working directory
// unless another is made primary — that ordering IS the contract with the
// server, so the up/down controls are functional, not decoration.

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Home,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Badge, Button, Checkbox, Input, Select, Spinner, Tooltip } from '@/components/ui/index.js';
import { useProjects, useProjectCodebases, useCodebaseBranches } from '@/hooks/projectQueries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import type { HttpPlatformClient } from '@/platform/HttpPlatformClient.js';
import { useFsGitInfo } from '@/hooks/sourceQueries.js';
import { cn } from '@/lib/utils.js';
import { DirectoryBrowser } from './DirectoryBrowser.js';
import {
  defaultNewBranch,
  draftFromCodebase,
  draftFromFolder,
  sourcesSummary,
  type BranchMode,
  type DraftSource,
  type SourceMode,
} from './sourceModel.js';

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
}: SourcePickerProps) {
  const platform = usePlatform() as HttpPlatformClient;
  const { data: projects } = useProjects();
  const { data: codebases, isLoading: codebasesLoading } = useProjectCodebases(projectId || undefined);
  const [browserOpen, setBrowserOpen] = useState(false);

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
    (cb: { id: string; alias: string; type: string; url?: string; localPath?: string; defaultBranch?: string }) => {
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
        info = await platform.getFsGitInfo(path);
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
    [atLimit, platform, takenAliases, drafts, onChange, onPrimaryChange],
  );

  const selectedCodebaseIds = useMemo(
    () => new Set(drafts.filter((d) => d.kind === 'codebase').map((d) => d.codebaseId)),
    [drafts],
  );

  return (
    <div className="space-y-3">
      {/* ── Project + its codebases ─────────────────────────────── */}
      <div>
        <label
          htmlFor="chat-project"
          className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <FolderGit2 className="h-4 w-4 text-primary" />
          Sources
        </label>
        <Select
          id="chat-project"
          aria-label="Project"
          disabled={disabled}
          value={projectId}
          onChange={onProjectIdChange}
          options={[
            { value: '', label: 'No project' },
            ...(projects ?? [])
              .filter((p) => p.status === 'active')
              .map((p) => ({ value: p.id, label: p.name })),
          ]}
        />

        {projectId && (
          <div className="mt-2 space-y-1.5">
            {codebasesLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner size="sm" label="Loading codebases" /> Loading codebases…
              </div>
            ) : !codebases || codebases.length === 0 ? (
              <p className="text-xs text-muted-foreground">No codebases linked to this project.</p>
            ) : (
              codebases.map((cb) => {
                const checked = selectedCodebaseIds.has(cb.id);
                const notReady = cb.status !== 'ready';
                const blocked = (!checked && atLimit) || notReady || disabled;
                return (
                  <label
                    key={cb.id}
                    htmlFor={`source-cb-${cb.id}`}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
                      blocked
                        ? 'cursor-not-allowed border-border opacity-50'
                        : checked
                          ? 'cursor-pointer border-primary bg-primary/5'
                          : 'cursor-pointer border-border hover:border-primary/50',
                    )}
                  >
                    <Checkbox
                      id={`source-cb-${cb.id}`}
                      checked={checked}
                      disabled={blocked}
                      onCheckedChange={() =>
                        toggleCodebase({
                          id: cb.id,
                          alias: cb.alias,
                          type: cb.type,
                          ...(cb.url ? { url: cb.url } : {}),
                          ...(cb.localPath ? { localPath: cb.localPath } : {}),
                          ...(cb.defaultBranch ? { defaultBranch: cb.defaultBranch } : {}),
                        })
                      }
                      className="h-3.5 w-3.5"
                    />
                    {cb.type === 'local-dir' ? (
                      <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <GitBranch className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="font-medium">{cb.alias}</span>
                    <Badge tone={cb.status === 'ready' ? 'success' : 'warning'} size="sm" className="ml-auto">
                      {cb.status}
                    </Badge>
                  </label>
                );
              })
            )}
          </div>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          disabled={disabled || atLimit}
          onClick={() => setBrowserOpen(true)}
          leftIcon={<FolderPlus className="h-3.5 w-3.5" />}
          data-testid="add-local-folder"
        >
          Add local folder
        </Button>
        {atLimit && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Maximum of {maxSources} sources reached.
          </p>
        )}
      </div>

      {/* ── The mount plan ──────────────────────────────────────── */}
      {drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No sources yet. The agent gets an empty managed workspace and builds from scratch — tick a
          codebase or add a local folder to point it at existing code.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="source-list">
          {drafts.map((draft, index) => (
            <li key={draft.key}>
              <SourceRow
                draft={draft}
                index={index}
                total={drafts.length}
                chatName={chatName}
                projectId={projectId}
                disabled={disabled}
                isPrimary={draft.alias === effectivePrimary}
                onChange={(next) => replaceAt(index, next)}
                onRemove={() => removeAt(index)}
                onMakePrimary={() => onPrimaryChange(draft.alias)}
                onMove={(delta) => move(index, delta)}
              />
            </li>
          ))}
        </ul>
      )}

      {drafts.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="sources-summary">
          {sourcesSummary(drafts, chatName)}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 rounded-md bg-danger-muted px-2 py-1.5 text-xs text-danger" role="alert">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <DirectoryBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onPick={(p) => void addFolder(p)}
      />
    </div>
  );
}

// ── One source ─────────────────────────────────────────────────

interface SourceRowProps {
  draft: DraftSource;
  index: number;
  total: number;
  chatName: string;
  projectId: string;
  disabled: boolean;
  isPrimary: boolean;
  onChange: (next: DraftSource) => void;
  onRemove: () => void;
  onMakePrimary: () => void;
  onMove: (delta: number) => void;
}

function SourceRow({
  draft,
  index,
  total,
  chatName,
  projectId,
  disabled,
  isPrimary,
  onChange,
  onRemove,
  onMakePrimary,
  onMove,
}: SourceRowProps) {
  // Branch lists come from whichever side owns them: a codebase's are served
  // by the project API, a folder's by `fs/git-info`. Both are read-only here —
  // the draft's own `meta` stays the authority for what the source CAN do.
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

  const dirty = folderInfo.data?.dirty ?? draft.meta.dirty ?? false;
  const nested = folderInfo.data?.nestedRepos ?? draft.meta.nestedRepos ?? [];
  const currentBranch = folderInfo.data?.currentBranch ?? draft.meta.defaultBranch ?? null;

  const [copied, setCopied] = useState(false);
  const copyPath = useCallback(() => {
    const value = draft.meta.origin ?? draft.path ?? '';
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  }, [draft.meta.origin, draft.path]);

  const setMode = (mode: SourceMode) => {
    // A worktree always lands on a branch of its own, so "leave it where it
    // is" is not a coherent answer once the mode flips.
    const branchMode: BranchMode =
      mode === 'worktree' && draft.branchMode === 'current' ? 'new' : draft.branchMode;
    onChange({ ...draft, mode, branchMode });
  };

  const rowDisabled = disabled;

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5',
        isPrimary ? 'border-primary/50 bg-primary/[0.04]' : 'border-border',
      )}
    >
      {/* Identity line */}
      <div className="flex items-center gap-1.5">
        {draft.kind === 'codebase' ? (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Input
          value={draft.alias}
          disabled={rowDisabled}
          onChange={(e) => onChange({ ...draft, alias: e.target.value })}
          aria-label={`Name for ${draft.meta.label}`}
          className="h-6 w-32 px-2 py-0 text-xs font-medium"
        />
        {draft.meta.isGit ? (
          <Badge tone="info" size="sm" title={currentBranch ?? 'git repository'}>
            {currentBranch ?? 'git'}
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            plain folder
          </Badge>
        )}
        {dirty && (
          <Tooltip content="This repository has uncommitted changes. Switching branches will be refused until it is clean.">
            <span
              className="inline-flex items-center gap-1 text-[10px] text-warning"
              data-testid="source-dirty"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
              uncommitted
            </span>
          </Tooltip>
        )}
        {nested.length > 0 && (
          <Tooltip content={`Nested repositories: ${nested.join(', ')}`}>
            <span className="text-[10px] text-muted-foreground">
              {nested.length} nested {nested.length === 1 ? 'repo' : 'repos'}
            </span>
          </Tooltip>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            disabled={rowDisabled || index === 0}
            onClick={() => onMove(-1)}
            title="Move up"
            aria-label={`Move ${draft.alias} up`}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            disabled={rowDisabled || index === total - 1}
            onClick={() => onMove(1)}
            title="Move down"
            aria-label={`Move ${draft.alias} down`}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6 text-muted-foreground hover:text-danger"
            disabled={rowDisabled}
            onClick={onRemove}
            title="Remove this source"
            aria-label={`Remove ${draft.alias}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Origin */}
      {(draft.meta.origin ?? draft.path) && (
        <div className="mt-1 flex items-center gap-1">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground"
            title={draft.meta.origin ?? draft.path}
          >
            {draft.meta.origin ?? draft.path}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5 shrink-0"
            onClick={copyPath}
            title="Copy path"
            aria-label={`Copy path of ${draft.alias}`}
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Segmented
          label="Mode"
          disabled={rowDisabled}
          value={draft.mode}
          onChange={(v) => setMode(v as SourceMode)}
          options={[
            {
              value: 'worktree',
              label: 'Worktree',
              disabled: !draft.meta.allowWorktree,
              reason: draft.meta.allowWorktreeReason,
            },
            {
              value: 'in-place',
              label: 'In place',
              disabled: !draft.meta.allowInPlace,
              reason: draft.meta.allowInPlaceReason,
            },
          ]}
        />

        <Segmented
          label="Branch"
          disabled={rowDisabled}
          value={draft.branchMode}
          onChange={(v) => onChange({ ...draft, branchMode: v as BranchMode })}
          options={[
            // A worktree with no branch of its own would fight the checkout it
            // was cut from, so "current" is offered only for in-place mounts.
            ...(draft.mode === 'in-place'
              ? [{ value: 'current', label: currentBranch ? `Stay on ${currentBranch}` : 'Current branch' }]
              : []),
            { value: 'new', label: 'New branch' },
            {
              value: 'existing',
              label: 'Existing branch',
              disabled: branches.length === 0,
              reason: 'No branches were found in this repository.',
            },
          ]}
        />

        {draft.branchMode === 'new' && (
          <>
            <Input
              value={draft.newBranch}
              disabled={rowDisabled}
              onChange={(e) => onChange({ ...draft, newBranch: e.target.value })}
              placeholder={defaultNewBranch(chatName)}
              aria-label={`New branch name for ${draft.alias}`}
              className="h-6 w-52 px-2 py-0 font-mono text-[11px]"
            />
            <span className="text-[11px] text-muted-foreground">from</span>
            <Select
              value={draft.baseRef}
              disabled={rowDisabled}
              onChange={(v) => onChange({ ...draft, baseRef: v })}
              aria-label={`Base branch for ${draft.alias}`}
              className="h-6 w-40 px-2 py-0 text-[11px]"
              options={[
                { value: '', label: currentBranch ? `Current (${currentBranch})` : 'Current HEAD' },
                ...branches.map((b) => ({ value: b, label: b })),
              ]}
            />
          </>
        )}

        {draft.branchMode === 'existing' && (
          <Select
            value={draft.branch}
            disabled={rowDisabled || branches.length === 0}
            onChange={(v) => onChange({ ...draft, branch: v })}
            aria-label={`Branch for ${draft.alias}`}
            placeholder="Choose a branch…"
            className="h-6 w-52 px-2 py-0 text-[11px]"
            options={branches.map((b) => ({ value: b, label: b }))}
          />
        )}

        <Button
          type="button"
          variant={isPrimary ? 'secondary' : 'ghost'}
          size="sm"
          disabled={rowDisabled || isPrimary}
          onClick={onMakePrimary}
          aria-pressed={isPrimary}
          className="ml-auto h-6 gap-1 px-2 text-[11px]"
          title="The agent's working directory"
          leftIcon={<Home className="h-3 w-3" />}
        >
          {isPrimary ? 'Working directory' : 'Make working directory'}
        </Button>
      </div>

      {draft.branchMode !== 'current' && dirty && draft.mode === 'in-place' && (
        <p className="mt-1.5 text-[11px] text-warning">
          {draft.alias} has uncommitted changes — the branch switch will be refused until it is
          committed or stashed.
        </p>
      )}
      {draft.meta.error && <p className="mt-1.5 text-[11px] text-danger">{draft.meta.error}</p>}
    </div>
  );
}

// ── Segmented control ──────────────────────────────────────────

interface SegmentedOption {
  value: string;
  label: string;
  disabled?: boolean;
  reason?: string | undefined;
}

/**
 * A radio group that reads as a toggle. Deliberately not a `Select`: there
 * are only two or three choices, and the disabled ones have to explain
 * themselves (a bare clone cannot be edited in place) — which a native
 * option cannot do.
 */
function Segmented({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-px" role="radiogroup" aria-label={label}>
      {options.map((opt) => {
        const button = (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={value === opt.value}
            disabled={disabled || opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'h-5 rounded px-2 text-[11px] font-normal',
              value === opt.value
                ? 'bg-accent text-foreground hover:bg-accent'
                : 'text-muted-foreground hover:bg-accent/50',
            )}
          >
            {opt.label}
          </Button>
        );
        return opt.disabled && opt.reason ? (
          // A disabled button swallows pointer events, so the tooltip needs a
          // wrapper that still receives them — otherwise the explanation for
          // why the control is off is unreachable.
          <Tooltip key={opt.value} content={opt.reason}>
            <span className="inline-flex cursor-not-allowed">{button}</span>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
