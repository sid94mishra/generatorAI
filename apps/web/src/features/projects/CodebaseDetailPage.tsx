// ────────────────────────────────────────────────────────────────
// CodebaseDetailPage (P5-05; T-02 DetailPage; board CodebaseDetail;
// F-projects-09; 04-screen-map.md R-3, §4.5 #51).
//
// PageHeader (Projects / project / alias · status · Logs · More), PageTitle
// ("Git remote · cloned to <path>"), a stats card (Remote + copy ·
// Default branch picker · Last fetched · Active worktrees · Fetch), and tabs as path
// segments: /projects/:id/codebases/:cid/worktrees|files. Fetch runs as a
// G-16 job; its output streams into the Logs dialog. "Change default branch"
// lives in More (and on the stats card's branch control).
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import type { ProjectCodebase } from '@generatorai/shared';
import { useOpenInEditor } from '@/hooks/queries.js';
import {
  useCodebaseBranches,
  useCodebaseWorktreesUsage,
  useProject,
  useUnlinkCodebase,
  useUpdateCodebase,
} from '@/hooks/projectQueries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { formatRelativeTime } from '@/utils/formatRelativeTime.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { Combobox } from '@/ui/primitives/Combobox/Combobox.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Tabs } from '@/ui/primitives/Tabs/Tabs.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { CodebaseLogsDialog, CodebaseStatusBadge, useFetchCodebaseAction, useLiveCodebases } from './codebaseParts.js';
import { FilesTab } from './codebase/FilesTab.js';
import { WorktreesTab } from './codebase/WorktreesTab.js';
import { CODEBASE_TYPE_LABEL, codebaseLocation, codebaseRemoveConfirm, isCodebaseBusy } from './projectFormat.js';

type CodebaseTab = 'worktrees' | 'files';

function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 border-l border-line-soft px-4 py-3 first:border-l-0">
      <span className="text-small text-fg-3">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 text-ui text-fg">{children}</div>
    </div>
  );
}

function DefaultBranchPicker({
  projectId,
  codebase,
  open,
  onOpenChange,
}: {
  projectId: string;
  codebase: ProjectCodebase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = codebase.defaultBranch ?? 'main';
  const branches = useCodebaseBranches(open ? projectId : undefined, open ? codebase.id : undefined);
  const update = useUpdateCodebase();
  const names = branches.data && branches.data.length > 0 ? branches.data : [current];
  return (
    <Combobox
      label="Default branch"
      icon="branch"
      value={current}
      open={open}
      onOpenChange={onOpenChange}
      searchPlaceholder="Search branches"
      emptyText={branches.isLoading ? 'Loading branches…' : 'No branches found.'}
      items={names.map((b) => ({ value: b, label: b }))}
      disabled={update.isPending}
      className="max-w-full font-mono"
      onValueChange={(branch) => {
        if (!branch || branch === current) return;
        update.mutate(
          { projectId, codebaseId: codebase.id, defaultBranch: branch },
          { onError: (err) => toast.error("Couldn't change the default branch", { description: err instanceof Error ? err.message : String(err) }) },
        );
      }}
    />
  );
}

export function CodebaseDetailPage() {
  const { id: projectId, cid: codebaseId, tab: tabParam } = useParams<{ id: string; cid: string; tab?: string }>();
  const navigate = useNavigate();
  const tab: CodebaseTab = tabParam === 'files' ? 'files' : 'worktrees';
  const { data: project } = useProject(projectId);
  const codebases = useLiveCodebases(projectId);
  const worktrees = useCodebaseWorktreesUsage(projectId, codebaseId);
  const fetchAction = useFetchCodebaseAction(projectId);
  const unlink = useUnlinkCodebase();
  const openInEditor = useOpenInEditor();
  const confirmer = useConfirm();
  const [logsOpen, setLogsOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const codebase = codebases.data?.find((cb) => cb.id === codebaseId);
  usePageTitle(codebase?.alias);

  if (!projectId || !codebaseId) return null;
  if (codebases.isLoading) return <SkeletonRows rows={6} label="Loading codebase" className="p-7" />;
  if (!codebase) {
    return (
      <EmptyState
        className="h-full"
        tone="error"
        icon="warning"
        title="Codebase not found"
        action={
          <Button size="sm" render={<RouterLink to={`/projects/${projectId}`} />}>
            Back to project
          </Button>
        }
      />
    );
  }

  const git = codebase.type !== 'local-dir';
  const checkout = codebase.clonePath ?? codebase.localPath;
  const activeWorktrees = worktrees.data?.items.filter((w) => w.status === 'active').length;
  const worktreeCount = worktrees.data?.items.length;

  const remove = async () => {
    const ok = await confirmer.confirm(codebaseRemoveConfirm(codebase));
    if (!ok) return;
    try {
      await unlink.mutateAsync({ projectId, codebaseId });
      navigate(`/projects/${projectId}/codebases`);
    } catch (err) {
      toast.error("Couldn't delete the codebase", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const copy = (text: string) =>
    void copyTextToClipboard(text).catch((err: unknown) => toast.error("Couldn't copy", { description: String(err) }));

  return (
    <>
      <DetailPage
        header={
          <PageHeader
            breadcrumb={
              <Breadcrumb
                items={[
                  { label: 'Projects', render: <RouterLink to="/projects" /> },
                  { label: project?.name ?? 'Project', render: <RouterLink to={`/projects/${projectId}/codebases`} /> },
                  { label: codebase.alias },
                ]}
              />
            }
            status={<CodebaseStatusBadge codebase={codebase} />}
            actions={
              <>
                <Button icon="terminal" onClick={() => setLogsOpen(true)}>
                  Logs
                </Button>
                <MenuButton
                  label="More codebase actions"
                  iconOnly
                  icon="more"
                  items={[
                    ...(git
                      ? [{ id: 'branch', label: 'Change default branch…', icon: 'branch' as const, onSelect: () => setBranchOpen(true) }]
                      : []),
                    ...(checkout
                      ? [
                          { id: 'editor', label: 'Open in editor', icon: 'external-link' as const, onSelect: () => openInEditor.mutate({ path: checkout }) },
                          { id: 'copy-path', label: 'Copy local path', icon: 'copy' as const, onSelect: () => copy(checkout) },
                        ]
                      : []),
                    { type: 'separator' as const },
                    { id: 'delete', label: codebase.type === 'git-remote' ? 'Delete codebase…' : 'Remove from project…', icon: 'trash' as const, danger: true, onSelect: () => void remove() },
                  ]}
                />
              </>
            }
          />
        }
        title={
          <PageTitle
            variant="detail"
            title={codebase.alias}
            description={
              <>
                {CODEBASE_TYPE_LABEL[codebase.type]}
                {checkout ? (
                  <>
                    {' · '}
                    {codebase.type === 'git-remote' ? 'cloned to ' : ''}
                    <span className="font-mono text-small">{checkout}</span>
                  </>
                ) : null}
              </>
            }
          />
        }
        banner={
          <Card className="flex">
            <StatCell label={codebase.type === 'git-remote' ? 'Remote' : 'Path'}>
              <span className="truncate font-mono text-small">{codebaseLocation(codebase)}</span>
              <IconButton size="sm" icon="copy" label="Copy" onClick={() => copy(codebaseLocation(codebase))} />
            </StatCell>
            {git ? (
              <StatCell label="Default branch">
                <DefaultBranchPicker projectId={projectId} codebase={codebase} open={branchOpen} onOpenChange={setBranchOpen} />
              </StatCell>
            ) : null}
            <StatCell label="Last fetched">
              <span className="font-mono text-small">{codebase.lastFetchedAt ? formatRelativeTime(new Date(codebase.lastFetchedAt)) : 'Never'}</span>
            </StatCell>
            <StatCell label="Active worktrees">
              <span className="font-mono text-small">{activeWorktrees ?? '—'}</span>
            </StatCell>
            {git ? (
              <div className="flex shrink-0 items-center pr-3">
                <Button
                  icon="refresh"
                  size="sm"
                  loading={fetchAction.pendingId === codebase.id}
                  disabled={isCodebaseBusy(codebase.status)}
                  onClick={() => fetchAction.run(codebase)}
                >
                  Fetch
                </Button>
              </div>
            ) : null}
          </Card>
        }
        tabs={
          <Tabs
            label="Codebase sections"
            value={tab}
            onValueChange={(next) => navigate(`/projects/${projectId}/codebases/${codebaseId}/${next}`)}
            items={[
              { value: 'worktrees', label: 'Worktrees', count: worktreeCount },
              { value: 'files', label: 'Files' },
            ]}
          />
        }
        content={tab === 'files' ? <FilesTab projectId={projectId} codebaseId={codebaseId} /> : <WorktreesTab projectId={projectId} codebaseId={codebaseId} />}
      />
      <CodebaseLogsDialog projectId={projectId} codebase={codebase} open={logsOpen} onOpenChange={setLogsOpen} />
      {confirmer.dialog}
    </>
  );
}
