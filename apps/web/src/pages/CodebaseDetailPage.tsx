// ────────────────────────────────────────────────────────────────
// CodebaseDetailPage — Single codebase view with worktrees + files
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  GitBranch,
  HardDrive,
  FolderOpen,
  AlertCircle,
  Trash2,
  RefreshCw,
  Globe,
  FileCode,
  ScrollText,
  Clock,
  Check,
  Search,
  ChevronsUpDown,
  Eye,
  Code2,
} from 'lucide-react';

import {
  useProject,
  useProjectCodebases,
  useCodebaseWorktrees,
  useCodebaseBranches,
  useRemoveWorktree,
  useCleanupWorktrees,
  useFetchCodebase,
  useUpdateCodebase,
  useCodebaseFileContent,
} from '@/hooks/projectQueries.js';
import { CodebaseFileBrowser } from '@/components/codebase/CodebaseFileBrowser.js';
import { FileExplorer, FileExplorerEmptyState } from '@/components/shared/FileExplorer.js';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { extToLang } from '@/components/common/SyntaxHighlightedCode.js';
import { FileCodeView } from '@/components/diff/FileCodeView.js';
import { toast } from '@/components/Toast.js';
import { Modal, Button, Badge, Spinner, Tabs, PageHeader, Popover, PopoverTrigger, PopoverContent, type BadgeTone } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { cn } from '@/lib/utils.js';
import type { CodebaseType, ProjectCodebase } from '@generatorai/shared';

type Tab = 'worktrees' | 'files';

export function CodebaseDetailPage() {
  const { id: projectId, cid: codebaseId } = useParams<{ id: string; cid: string }>();
  const navigate = useNavigate();

  const { data: project } = useProject(projectId);
  const [isCloningState, setIsCloningState] = useState(false);
  const { data: codebases, isLoading } = useProjectCodebases(projectId, {
    refetchInterval: isCloningState ? 3000 : false,
  });
  const { data: worktrees } = useCodebaseWorktrees(projectId, codebaseId);

  const removeWorktree = useRemoveWorktree();
  const cleanupWorktrees = useCleanupWorktrees();
  const fetchCodebase = useFetchCodebase();
  const updateCodebase = useUpdateCodebase();

  const [tab, setTab] = useState<Tab>('worktrees');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [showLogViewer, setShowLogViewer] = useState(false);

  const codebase = codebases?.find((cb) => cb.id === codebaseId);

  // Derive log content reactively from current codebase data
  const logContent = useMemo(() => {
    if (!showLogViewer || !codebase) return null;
    const logLines = [`Codebase: ${codebase.alias}`, `Type: ${codebase.type}`, `Status: ${codebase.status}`, codebase.url ? `URL: ${codebase.url}` : `Path: ${codebase.localPath}`];
    if (codebase.status === 'cloning' || codebase.status === 'pending') {
      logLines.push('', 'Clone Status:', 'Cloning is in progress. The page will auto-refresh when complete.', 'If cloning takes too long, check server logs or delete and re-link.');
    }
    if (codebase.lastError) {
      logLines.push('', 'Error Details:', codebase.lastError);
    }
    if (codebase.lastFetchedAt) {
      logLines.push('', `Last fetched: ${new Date(codebase.lastFetchedAt).toLocaleString()}`);
    }
    return logLines.join('\n');
  }, [showLogViewer, codebase]);

  // Track clone status change
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!codebase) return;
    setIsCloningState(codebase.status === 'cloning' || codebase.status === 'pending');
    if (prevStatus.current && prevStatus.current !== codebase.status) {
      if ((prevStatus.current === 'cloning' || prevStatus.current === 'pending') && codebase.status === 'ready') {
        toast({ variant: 'success', title: 'Clone complete', description: `"${codebase.alias}" is ready to use` });
      } else if ((prevStatus.current === 'cloning' || prevStatus.current === 'pending') && codebase.status === 'error') {
        toast({ variant: 'error', title: 'Clone failed', description: `"${codebase.alias}" failed to clone`, logs: codebase.lastError ?? 'Unknown error', duration: 0 });
      }
    }
    prevStatus.current = codebase.status;
  }, [codebase]);

  const statusBadge = (status: string) => {
    const tones: Record<string, BadgeTone> = {
      ready: 'success',
      cloning: 'info',
      pending: 'warning',
      error: 'danger',
      active: 'success',
      completed: 'neutral',
      orphaned: 'warning',
    };
    return (
      <Badge tone={tones[status] ?? 'warning'} size="sm">
        {status}
      </Badge>
    );
  };

  const typeBadge = (type: CodebaseType) => {
    const icons: Record<CodebaseType, React.ReactElement> = {
      'git-remote': <Globe className="h-3 w-3" />,
      'git-local': <GitBranch className="h-3 w-3" />,
      'local-dir': <FolderOpen className="h-3 w-3" />,
    };
    const typeLabels: Record<CodebaseType, string> = {
      'git-remote': 'Remote Git',
      'git-local': 'Local Git',
      'local-dir': 'Local Dir',
    };
    return (
      <Badge tone="neutral" size="sm">
        {icons[type]}
        {typeLabels[type]}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" className="text-muted-foreground" />
      </div>
    );
  }

  if (!codebase) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">Codebase not found</p>
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="text-sm text-primary underline"
        >
          Back to Project
        </button>
      </div>
    );
  }

  return (
    <PageContainer className="flex flex-col space-y-6">
      {/* Header */}
      <PageHeader
        leading={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/projects/${projectId}`)}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <GitBranch className="h-6 w-6 text-primary" />
          </div>
        }
        title={
          <span className="flex items-center gap-2">
            {codebase.alias}
            {typeBadge(codebase.type)}
            {statusBadge(codebase.status)}
          </span>
        }
        subtitle={
          <>
            <span className="font-mono text-xs">{codebase.url ?? codebase.localPath ?? '—'}</span>
            {project && <span className="block text-xs">Project: {project.name}</span>}
          </>
        }
        actions={
          <>
          {(codebase.status === 'cloning' || codebase.status === 'pending') && (
            <span className="flex items-center gap-1.5 rounded-lg border border-info/30 px-3 py-1.5 text-xs font-medium text-info">
              <Spinner size="sm" />
              Cloning...
            </span>
          )}
          <Button
            variant={codebase.status === 'error' ? 'danger' : 'secondary'}
            size="sm"
            onClick={() => setShowLogViewer(true)}
            leftIcon={<ScrollText className="h-3.5 w-3.5" />}
          >
            View Logs
          </Button>
          {codebase.type !== 'local-dir' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchCodebase.mutate(
                { projectId: projectId!, codebaseId: codebase.id },
                {
                  onSuccess: () => toast({ variant: 'success', title: 'Sync complete', description: `"${codebase.alias}" is up to date with latest changes` }),
                  onError: (err) => {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    toast({
                      variant: 'error',
                      title: 'Sync failed',
                      description: `Could not fetch latest for "${codebase.alias}"`,
                      logs: `Codebase: ${codebase.alias}\nOperation: git fetch --all\n\nError:\n${errMsg}\n\nIf you have conflicts, resolve them locally and try again.`,
                      duration: 0,
                    });
                  },
                },
              )}
              disabled={fetchCodebase.isPending}
              leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', fetchCodebase.isPending && 'animate-spin')} />}
            >
              Fetch Latest
            </Button>
          )}
          </>
        }
      />

      {/* Metadata bar — compact, streamlined */}
      <div className="flex flex-wrap items-stretch gap-x-6 gap-y-3 rounded-xl border border-border bg-card px-4 py-3">
        <MetaItem
          icon={<HardDrive className="h-4 w-4" />}
          label="Active worktrees"
          value={String(worktrees?.filter((w) => w.status === 'active').length ?? 0)}
        />
        <span className="hidden w-px self-stretch bg-border sm:block" />
        <DefaultBranchControl
          projectId={projectId}
          codebase={codebase}
          onSave={async (branch) => {
            await updateCodebase.mutateAsync({ projectId: projectId!, codebaseId: codebase.id, defaultBranch: branch });
            toast({ variant: 'success', title: 'Default branch updated', description: `Now tracking "${branch}"` });
          }}
          saving={updateCodebase.isPending}
        />
        <span className="hidden w-px self-stretch bg-border sm:block" />
        <MetaItem
          icon={<Clock className="h-4 w-4" />}
          label="Last fetched"
          value={codebase.lastFetchedAt ? new Date(codebase.lastFetchedAt).toLocaleString() : 'Never'}
        />
      </div>

      {/* Tabs */}
      <Tabs<Tab>
        items={[
          { id: 'worktrees', label: 'Worktrees', icon: <HardDrive className="h-4 w-4" /> },
          { id: 'files', label: 'Files', icon: <FileCode className="h-4 w-4" /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Worktrees Tab */}
      {tab === 'worktrees' && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Active Worktrees</h2>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => cleanupWorktrees.mutate(projectId!)}
              disabled={cleanupWorktrees.isPending}
              loading={cleanupWorktrees.isPending}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Cleanup Orphans
            </Button>
          </div>

          {(!worktrees || worktrees.length === 0) && (
            <p className="text-sm text-muted-foreground">
              No worktrees for this codebase. Worktrees are created automatically during workflow runs.
            </p>
          )}
          {worktrees && worktrees.length > 0 && (
            <div className="space-y-2">
              {worktrees.map((wt) => (
                <div
                  key={wt.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-primary">
                      <HardDrive className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{wt.branchName}</span>
                        {statusBadge(wt.status)}
                        {wt.runType && (
                          <Badge tone="neutral" size="sm">
                            {wt.runType}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {wt.worktreePath}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(wt.id)}
                    className="shrink-0 hover:bg-danger-muted hover:text-danger"
                    title="Remove worktree"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Files Tab */}
      {tab === 'files' && projectId && codebaseId && (
        <div className="min-h-0 flex-1">
          <FileExplorer
            filter={fileFilter}
            onFilterChange={setFileFilter}
            hasSelection={!!selectedFile}
            emptyState={<FileExplorerEmptyState />}
            tree={
              <CodebaseFileBrowser
                projectId={projectId}
                codebaseId={codebaseId}
                selectedFile={selectedFile}
                onFileSelect={(p) => setSelectedFile(p)}
                filter={fileFilter}
                noBorder
              />
            }
          >
            <FilePreviewPanel
              projectId={projectId}
              codebaseId={codebaseId}
              filePath={selectedFile ?? ''}
            />
          </FileExplorer>
        </div>
      )}

      {/* Delete Worktree Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove Worktree"
        description="Are you sure you want to remove this worktree? This will delete the worktree directory and its branch. This action cannot be undone."
        variant="destructive"
        confirmLabel="Remove Worktree"
        onConfirm={async () => {
          if (!deleteTarget || !projectId) return;
          try {
            await removeWorktree.mutateAsync({ projectId, worktreeId: deleteTarget });
            toast({ variant: 'success', title: 'Worktree removed', description: 'Worktree has been deleted successfully' });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            toast({
              variant: 'error',
              title: 'Failed to remove worktree',
              description: errMsg,
              logs: `Operation: Remove worktree\nWorktree ID: ${deleteTarget}\n\nError:\n${errMsg}`,
              duration: 0,
            });
          }
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      />

      {/* Log Viewer Modal */}
      {logContent !== null && (
        <Modal
          open
          onClose={() => setShowLogViewer(false)}
          size="lg"
          title={
            <span className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              Operation Logs
            </span>
          }
        >
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">
            {logContent}
          </pre>
        </Modal>
      )}
    </PageContainer>
  );
}

// ────────────────────────────────────────────────────────────────
// FilePreviewPanel — Inline split-pane right side preview
// ────────────────────────────────────────────────────────────────

function FilePreviewPanel({
  projectId,
  codebaseId,
  filePath,
}: {
  projectId: string;
  codebaseId: string;
  filePath: string;
}) {
  const { data: content, isLoading, error } = useCodebaseFileContent(projectId, codebaseId, filePath);

  const ext = filePath.split('.').pop() ?? '';
  const isMarkdown = ext === 'md' || ext === 'mdx';
  const lang = extToLang(ext);
  const fileName = filePath.split('/').pop() ?? filePath;
  /** Markdown only: rendered preview vs. highlighted source. */
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'code'>('preview');

  return (
    <>
      {/* Panel header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-subtle/50 px-4 py-2.5">
        <FileTypeIcon name={fileName} className="h-3.5 w-3.5" />
        <span className="text-xs font-semibold text-foreground">{fileName}</span>
        <span className="truncate text-[10px] font-mono text-muted-foreground">
          {filePath}
        </span>
        {isMarkdown ? (
          <div className="ml-auto flex shrink-0 items-center rounded border border-border p-px">
            <button
              type="button"
              onClick={() => setMarkdownMode('preview')}
              aria-label="Rendered preview"
              aria-pressed={markdownMode === 'preview'}
              title="Rendered preview"
              className={cn(
                'inline-flex h-[18px] items-center rounded-sm px-1.5',
                markdownMode === 'preview'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Eye className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setMarkdownMode('code')}
              aria-label="Source code"
              aria-pressed={markdownMode === 'code'}
              title="Source code"
              className={cn(
                'inline-flex h-[18px] items-center rounded-sm px-1.5',
                markdownMode === 'code'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Code2 className="h-3 w-3" />
            </button>
          </div>
        ) : lang ? (
          <Badge tone="neutral" size="sm" className="ml-auto uppercase">
            {lang}
          </Badge>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="px-5 py-4 text-sm text-danger">
            Failed to load file: {(error as Error).message}
          </p>
        )}
        {content !== undefined && !isLoading && (
          isMarkdown && markdownMode === 'preview' ? (
            <div className="px-5 py-4">
              <MarkdownRenderer content={content} className="max-w-none" />
            </div>
          ) : (
            // Shares the diff viewer's worker pool + Shiki theme, so a
            // 20k-line file scrolls without blocking the main thread and
            // highlighting matches what the Changes panel shows.
            <FileCodeView
              name={filePath}
              contents={content}
              cacheKey={`${codebaseId}:${filePath}:${content.length}`}
              hideHeader
              style={{ height: '100%', overflow: 'auto' }}
            />
          )
        )}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// MetaItem — compact icon + label + value cell for the metadata bar
// ────────────────────────────────────────────────────────────────

function MetaItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// DefaultBranchControl — shows the default branch; for git codebases a
// small popover dropdown lets the user filter + pick a branch. Selecting
// a branch persists it immediately.
// ────────────────────────────────────────────────────────────────

function DefaultBranchControl({
  projectId,
  codebase,
  onSave,
  saving,
}: {
  projectId: string | undefined;
  codebase: ProjectCodebase;
  onSave: (branch: string) => Promise<void>;
  saving: boolean;
}) {
  const isGit = codebase.type === 'git-remote' || codebase.type === 'git-local';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { data: branches, isLoading } = useCodebaseBranches(
    open && isGit ? projectId : undefined,
    open && isGit ? codebase.id : undefined,
  );

  const current = codebase.defaultBranch ?? 'main';

  if (!isGit) {
    return <MetaItem icon={<GitBranch className="h-4 w-4" />} label="Default branch" value="—" />;
  }

  const list = branches ?? [current];
  const filtered = query.trim()
    ? list.filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()))
    : list;

  const handleSelect = async (branch: string) => {
    setOpen(false);
    setQuery('');
    if (branch !== current) await onSave(branch);
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <GitBranch className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">Default branch</span>
      </div>
      <div className="mt-1">
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={saving}
              className={cn(
                'flex h-7 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-background px-2 text-sm font-medium text-foreground',
                'transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
              )}
              aria-label="Change default branch"
            >
              {saving ? <Spinner size="xs" /> : <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate font-mono">{current}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <div className="border-b border-border p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search branches…"
                  className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Spinner size="sm" /> Loading branches…
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">No branches found.</p>
              ) : (
                filtered.map((b) => (
                  <button
                    key={b}
                    onClick={() => void handleSelect(b)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-subtle',
                      b === current && 'bg-primary/10 text-primary',
                    )}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono">{b}</span>
                    {b === current && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

