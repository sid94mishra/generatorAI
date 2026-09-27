// ────────────────────────────────────────────────────────────────
// ProjectDetailPage (P5-04; T-02 DetailPage; boards ProjectDetail +
// ProjectCustomization; F-projects-02; 04-screen-map.md §1 R-3, §2.4, §4.5).
//
// PageHeader (Projects / name · New chat · More), PageTitle (description +
// mono meta: root path · created · retention · max codebases), the needs-you
// Banner (G-01, filtered to the project), and tabs as PATH SEGMENTS (R-3):
// /projects/:id/codebases|chats|runs|pull-requests|customization|settings,
// `codebases` by default. Each tab is its own file under ./detail (the
// 1,389-line legacy page is split one file per tab).
// ────────────────────────────────────────────────────────────────

import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import { useNewChatStore } from '@/stores/newChatStore.js';
import { useAttention } from '@/hooks/attentionQueries.js';
import { useDeleteProject, useProject, useUpdateProject } from '@/hooks/projectQueries.js';
import { usePageTitle } from '@/hooks/usePageTitle.js';
import { copyTextToClipboard } from '@/utils/copyToClipboard.js';
import { Banner } from '@/ui/patterns/Banner/Banner.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Tabs } from '@/ui/primitives/Tabs/Tabs.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { DetailPage } from '@/ui/templates/DetailPage/DetailPage.js';
import { useLiveCodebases } from './codebaseParts.js';
import { ChatsTab } from './detail/ChatsTab.js';
import { CodebasesTab } from './detail/CodebasesTab.js';
import { CustomizationTab } from './detail/customization/CustomizationTab.js';
import { PullRequestsTab } from './detail/PullRequestsTab.js';
import { RunsTab } from './detail/RunsTab.js';
import { SettingsTab } from './detail/SettingsTab.js';
import { formatShortDate, plural, retentionLabel } from './projectFormat.js';

const TABS = ['codebases', 'chats', 'runs', 'pull-requests', 'customization', 'settings'] as const;
type ProjectTab = (typeof TABS)[number];
const TAB_LABEL: Record<ProjectTab, string> = {
  codebases: 'Codebases',
  chats: 'Chats',
  runs: 'Runs',
  'pull-requests': 'Pull requests',
  customization: 'Customization',
  settings: 'Settings',
};

function isTab(value: string | undefined): value is ProjectTab {
  return (TABS as readonly string[]).includes(value ?? '');
}

export function ProjectDetailPage() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const tab: ProjectTab = isTab(tabParam) ? tabParam : 'codebases';
  const { data: project, isLoading, error } = useProject(id, { includeSummary: true });
  const codebases = useLiveCodebases(id);
  const attention = useAttention({ projectId: id, enabled: Boolean(id) });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const confirmer = useConfirm();
  const openNewChat = useNewChatStore((s) => s.open);
  usePageTitle(project?.name);

  if (!id) return null;
  if (isLoading) return <SkeletonRows rows={6} label="Loading project" className="p-7" />;
  if (error || !project) {
    return (
      <EmptyState
        className="h-full"
        tone="error"
        icon="warning"
        title="Project not found"
        description={error instanceof Error ? error.message : undefined}
        action={
          <Button render={<RouterLink to="/projects" />} size="sm">
            Back to Projects
          </Button>
        }
      />
    );
  }

  const summary = project.summary;
  const archived = project.status === 'archived';
  const needsYou = attention.data?.needsYou ?? [];
  const first = needsYou[0];
  const counts: Partial<Record<ProjectTab, number>> = {
    codebases: codebases.data?.length ?? summary?.codebases,
    ...(summary ? { chats: summary.activeChats, runs: summary.runs } : {}),
  };

  const remove = async () => {
    const ok = await confirmer.confirm({
      title: `Delete ${project.name}?`,
      description: 'This permanently deletes the project and all its codebases, configs and worktrees. It can’t be undone.',
      confirmLabel: 'Delete project',
    });
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(project.id);
      navigate('/projects');
    } catch (err) {
      toast.error("Couldn't delete the project", { description: err instanceof Error ? err.message : String(err) });
    }
  };

  let content;
  switch (tab) {
    case 'codebases':
      content = <CodebasesTab projectId={id} codebases={codebases.data} isLoading={codebases.isLoading} error={codebases.error} />;
      break;
    case 'chats':
      content = <ChatsTab projectId={id} projectName={project.name} onNewChat={() => openNewChat({ projectId: id })} />;
      break;
    case 'runs':
      content = <RunsTab projectId={id} />;
      break;
    case 'pull-requests':
      content = <PullRequestsTab projectId={id} />;
      break;
    case 'customization':
      content = <CustomizationTab projectId={id} />;
      break;
    case 'settings':
      content = <SettingsTab project={project} />;
      break;
  }

  return (
    <>
      <DetailPage
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Projects', render: <RouterLink to="/projects" /> }, { label: project.name }]} />}
            status={archived ? <Badge tone="neutral">Archived</Badge> : undefined}
            actions={
              <>
                <Button icon="chats" onClick={() => openNewChat({ projectId: id })}>
                  New chat
                </Button>
                <MenuButton
                  label="More project actions"
                  iconOnly
                  icon="more"
                  items={[
                    {
                      id: 'copy-root',
                      label: 'Copy root path',
                      icon: 'copy',
                      onSelect: () =>
                        void copyTextToClipboard(project.rootPath).catch((err: unknown) =>
                          toast.error("Couldn't copy the root path", { description: String(err) }),
                        ),
                    },
                    { id: 'settings', label: 'Project settings', icon: 'settings', onSelect: () => navigate(`/projects/${id}/settings`) },
                    { type: 'separator' },
                    {
                      id: 'archive',
                      label: archived ? 'Unarchive' : 'Archive',
                      icon: archived ? 'undo' : 'archive',
                      onSelect: () =>
                        updateProject.mutate(
                          { id, status: archived ? 'active' : 'archived' },
                          { onError: (err) => toast.error("Couldn't update the project", { description: String(err) }) },
                        ),
                    },
                    { id: 'delete', label: 'Delete project…', icon: 'trash', danger: true, onSelect: () => void remove() },
                  ]}
                />
              </>
            }
          />
        }
        title={
          <PageTitle
            variant="detail"
            title={project.name}
            description={project.description}
            meta={[
              project.rootPath,
              `created ${formatShortDate(project.createdAt)}`,
              `worktree retention ${retentionLabel(project.settings?.worktreeRetention)}`,
              `max ${plural(project.settings?.maxCodebases ?? 10, 'codebase')}`,
            ]}
          />
        }
        banner={
          first ? (
            <Banner
              tone="warn"
              lead={`${needsYou.length} need${needsYou.length === 1 ? 's' : ''} you`}
              detail={[first.title, first.ask?.summary].filter(Boolean).join(' · ')}
              action={
                <Button size="sm" onClick={() => navigate(first.href)}>
                  Review
                </Button>
              }
            />
          ) : undefined
        }
        tabs={
          <Tabs
            label="Project sections"
            value={tab}
            onValueChange={(next) => navigate(`/projects/${id}/${next}`)}
            items={TABS.map((t) => ({ value: t, label: TAB_LABEL[t], count: counts[t] }))}
          />
        }
        content={content}
      />
      {confirmer.dialog}
    </>
  );
}
