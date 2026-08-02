// ────────────────────────────────────────────────────────────────
// ProjectDetailPage — Project dashboard with codebases, artifacts,
// settings management in tabbed layout
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FolderKanban,
  GitBranch,
  Settings,
  FileText,
  AlertCircle,
  Plus,
  Trash2,
  RefreshCw,
  Upload,
  X,
  HardDrive,
  FolderOpen,
  Globe,
  Shield,
  Bot,
  MessageSquare,
  Wrench,
  Eye,
  Server,
  Pencil,
  Save,
  FolderUp,
  List,
  Code2,
  ScrollText,
  CheckCircle2,
} from 'lucide-react';
import { toast } from '@/components/Toast.js';

import {
  useProject,
  useUpdateProject,
  useProjectCodebases,
  useProjectConfigs,
  useLinkCodebase,
  useUnlinkCodebase,
  useFetchCodebase,
  useUploadConfig,
  useDeleteConfig,
  useDeleteProject,
  useAvailableArtifacts,
  useArtifactContent,
  useUpdateArtifactContent,
  useProjectMcpServers,
  useSystemMcpServers,
  useCreateMcpServer,
  useDeleteMcpServer,
} from '@/hooks/projectQueries.js';
import { ConfirmDialog } from '@/components/ConfirmDialog.js';
import { SourceBadge } from '@/components/common/SourceBadge.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { SyntaxHighlightedCode, extToLang } from '@/components/common/SyntaxHighlightedCode.js';
import { Select, Modal, Button, Input, Tabs, Badge, Spinner, Switch, SearchInput, PageHeader, type BadgeTone } from '@/components/ui/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { SectionListHeader, CatalogAccordionRow } from '@/components/settings/shared.js';
import { useProjectCatalogPrefsStore } from '@/stores/projectCatalogPrefsStore.js';
import { cn } from '@/lib/utils.js';
import type { CodebaseType, ConfigType, ArtifactWithSource, McpServerEntry } from '@generatorai/shared';

type Tab = 'codebases' | 'artifacts' | 'settings';
type ArtifactCategory = 'skill' | 'prompt' | 'agent' | 'mcp';

const ARTIFACT_CATEGORIES: { key: ArtifactCategory; label: string; icon: typeof Wrench }[] = [
  { key: 'skill', label: 'Skills', icon: Wrench },
  { key: 'prompt', label: 'Prompts', icon: MessageSquare },
  { key: 'agent', label: 'Custom Agents', icon: Bot },
  { key: 'mcp', label: 'MCP Servers', icon: Server },
];

const RETENTION_OPTIONS = [
  { value: 'immediate', label: 'Immediate cleanup' },
  { value: 'hours-24', label: 'Keep for 24 hours' },
  { value: 'hours-72', label: 'Keep for 72 hours' },
  { value: 'manual', label: 'Manual cleanup only' },
] as const;
type RetentionValue = (typeof RETENTION_OPTIONS)[number]['value'];

/**
 * Editable project settings (worktree retention + max codebases). Previously
 * this tab was read-only, so retention/limit could only be chosen at creation
 * even though `PUT /projects/:id` accepts settings updates. Self-contained so
 * it owns its draft state and re-syncs after the project query refreshes.
 */
function ProjectSettingsForm({
  project,
}: {
  project: { id: string; rootPath: string; createdAt: string | Date; settings?: { worktreeRetention?: string; maxCodebases?: number } };
}): React.ReactElement {
  const updateProject = useUpdateProject();
  const savedRetention = (project.settings?.worktreeRetention ?? 'hours-24') as RetentionValue;
  const savedMax = project.settings?.maxCodebases ?? 10;
  const [retention, setRetention] = useState<RetentionValue>(savedRetention);
  const [maxCodebases, setMaxCodebases] = useState<number>(savedMax);

  // Re-sync the draft when the underlying project changes (e.g. after save
  // invalidates and refetches) so the form reflects persisted values.
  useEffect(() => {
    setRetention((project.settings?.worktreeRetention ?? 'hours-24') as RetentionValue);
    setMaxCodebases(project.settings?.maxCodebases ?? 10);
  }, [project.settings?.worktreeRetention, project.settings?.maxCodebases]);

  const dirty = retention !== savedRetention || maxCodebases !== savedMax;

  const handleSave = async (): Promise<void> => {
    try {
      await updateProject.mutateAsync({ id: project.id, settings: { worktreeRetention: retention, maxCodebases } });
      toast({ variant: 'success', title: 'Settings saved' });
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to save settings', description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <h2 className="text-sm font-medium text-foreground">Project Settings</h2>
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Worktree Retention</label>
          <Select
            value={retention}
            onChange={(v) => setRetention(v as RetentionValue)}
            options={RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Max Codebases</label>
          <Input
            type="number"
            min={1}
            max={50}
            value={maxCodebases}
            onChange={(e) => setMaxCodebases(Math.max(1, Math.min(50, Number(e.target.value))))}
          />
        </div>
        <div>
          <span className="text-xs font-medium text-muted-foreground">Root Path</span>
          <p className="text-xs font-mono text-muted-foreground">{project.rootPath}</p>
        </div>
        <div>
          <span className="text-xs font-medium text-muted-foreground">Created</span>
          <p className="text-sm text-foreground">{new Date(project.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!dirty || updateProject.isPending}
          >
            {updateProject.isPending ? 'Saving…' : 'Save Settings'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Utility: validate a skill folder upload has SKILL.md */
function validateSkillFolder(files: FileList): { valid: boolean; skillMd: File | null; allFiles: File[]; error?: string } {
  const allFiles = Array.from(files);
  const skillMd = allFiles.find(f => {
    const name = f.webkitRelativePath?.split('/').pop() ?? f.name;
    return name.toLowerCase() === 'skill.md';
  });
  if (allFiles.length === 0) return { valid: false, skillMd: null, allFiles, error: 'No files selected' };
  if (!skillMd) return { valid: false, skillMd: null, allFiles, error: 'Skill folder must contain a SKILL.md file' };
  return { valid: true, skillMd, allFiles };
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: project, isLoading, error } = useProject(id);
  const [hasInProgressClone, setHasInProgressClone] = useState(false);
  const { data: codebases } = useProjectCodebases(id, {
    refetchInterval: hasInProgressClone ? 3000 : false,
  });
  const { data: configs } = useProjectConfigs(id);
  const { data: availableArtifacts } = useAvailableArtifacts(id);

  // Track clone status changes — show toast when clone finishes, enable polling while cloning
  const prevCodebaseStatuses = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!codebases) return;
    const inProgress = codebases.some(cb => cb.status === 'cloning' || cb.status === 'pending');
    setHasInProgressClone(inProgress);

    for (const cb of codebases) {
      const prev = prevCodebaseStatuses.current[cb.id];
      if (prev && prev !== cb.status) {
        if ((prev === 'cloning' || prev === 'pending') && cb.status === 'ready') {
          toast({ variant: 'success', title: 'Clone complete', description: `"${cb.alias}" is ready to use` });
        } else if ((prev === 'cloning' || prev === 'pending') && cb.status === 'error') {
          toast({
            variant: 'error',
            title: 'Clone failed',
            description: `"${cb.alias}" failed to clone`,
            logs: cb.lastError ?? 'Unknown error',
            duration: 0,
          });
        }
      }
      prevCodebaseStatuses.current[cb.id] = cb.status;
    }
  }, [codebases]);

  const linkCodebase = useLinkCodebase();
  const unlinkCodebase = useUnlinkCodebase();
  const fetchCodebase = useFetchCodebase();
  const uploadConfig = useUploadConfig();
  const deleteConfig = useDeleteConfig();
  const deleteProject = useDeleteProject();

  const [tab, setTab] = useState<Tab>('codebases');
  const [showAddCodebase, setShowAddCodebase] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string } | null>(null);
  const [showDeleteProject, setShowDeleteProject] = useState(false);
  // Artifact category (left sidebar of artifacts tab)
  const [artifactCategory, setArtifactCategory] = useState<ArtifactCategory>('skill');
  // Artifact preview modal state
  const [previewArtifact, setPreviewArtifact] = useState<ArtifactWithSource | null>(null);
  // Per-section upload refs
  const skillsUploadRef = useRef<HTMLInputElement>(null);
  const promptsUploadRef = useRef<HTMLInputElement>(null);
  const agentsUploadRef = useRef<HTMLInputElement>(null);
  // MCP server add modal
  const [showAddMcp, setShowAddMcp] = useState(false);
  // Log viewer — store codebase ID so content stays reactive
  const [logViewCbId, setLogViewCbId] = useState<string | null>(null);
  const logContent = useMemo(() => {
    if (!logViewCbId || !codebases) return null;
    const cb = codebases.find(c => c.id === logViewCbId);
    if (!cb) return null;
    const logLines = [`Codebase: ${cb.alias}`, `Type: ${cb.type}`, `Status: ${cb.status}`, cb.url ? `URL: ${cb.url}` : `Path: ${cb.localPath}`];
    if (cb.status === 'cloning' || cb.status === 'pending') {
      logLines.push('', 'Clone Status:', 'Cloning is in progress. The page will auto-refresh when complete.', 'If cloning takes too long, check server logs or delete and re-link.');
    }
    if (cb.lastError) {
      logLines.push('', 'Error Details:', cb.lastError);
    }
    if (cb.lastFetchedAt) {
      logLines.push('', `Last fetched: ${new Date(cb.lastFetchedAt).toLocaleString()}`);
    }
    return logLines.join('\n');
  }, [logViewCbId, codebases]);

  // ── Add Codebase form state ──
  const [cbAlias, setCbAlias] = useState('');
  const [cbType, setCbType] = useState<CodebaseType>('git-remote');
  const [cbUrl, setCbUrl] = useState('');
  const [cbLocalPath, setCbLocalPath] = useState('');
  const [cbBranch, setCbBranch] = useState('');

  // ── Config upload (per-section) ──
  const configFileRef = useRef<HTMLInputElement>(null);
  const [configType, setConfigType] = useState<ConfigType>('agent');

  const isCodebaseFormValid =
    !!cbAlias.trim() &&
    (cbType === 'git-remote' ? !!cbUrl.trim() : !!cbLocalPath.trim());

  const handleAddCodebase = async () => {
    if (!id || !isCodebaseFormValid) return;

    try {
      await linkCodebase.mutateAsync({
        projectId: id,
        alias: cbAlias.trim(),
        type: cbType,
        url: cbType === 'git-remote' ? cbUrl.trim() : undefined,
        localPath: cbType !== 'git-remote' ? cbLocalPath.trim() : undefined,
        defaultBranch: cbBranch.trim() || undefined,
      });

      toast({ variant: 'info', title: 'Codebase linked', description: `"${cbAlias.trim()}" has been linked. ${cbType === 'git-remote' ? 'Cloning in progress — use the log icon to check status.' : ''}` });
      if (cbType === 'git-remote') setHasInProgressClone(true);
      setCbAlias('');
      setCbUrl('');
      setCbLocalPath('');
      setCbBranch('');
      setCbType('git-remote');
      setShowAddCodebase(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      toast({
        variant: 'error',
        title: 'Failed to link codebase',
        description: errMsg,
        logs: `Operation: Link codebase\nAlias: ${cbAlias.trim()}\nType: ${cbType}\nURL: ${cbType === 'git-remote' ? cbUrl.trim() : cbLocalPath.trim()}\n\nError:\n${errMsg}`,
        duration: 0,
      });
    }
  };

  const handleConfigUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type?: ConfigType) => {
      const uploadType = type ?? configType;
      if (!id || !e.target.files?.length) return;

      // Skill folder upload: validate SKILL.md presence
      if (uploadType === 'skill') {
        const { valid, allFiles, error } = validateSkillFolder(e.target.files);
        if (!valid) {
          toast({ variant: 'error', title: 'Invalid skill folder', description: error });
          e.target.value = '';
          return;
        }
        // Upload each file in the skill folder
        try {
          for (const file of allFiles) {
            if (file.size > 10 * 1024 * 1024) {
              toast({ variant: 'warning', title: 'File too large', description: `Skipped ${file.name} (>10MB)` });
              continue;
            }
            await uploadConfig.mutateAsync({ projectId: id, type: uploadType, file });
          }
          toast({ variant: 'success', title: 'Skill uploaded', description: `${allFiles.length} file(s) uploaded` });
        } catch (err) {
          toast({ variant: 'error', title: 'Failed to upload skill', description: err instanceof Error ? err.message : String(err) });
        }
        e.target.value = '';
        return;
      }

      const file = e.target.files[0]!;
      if (file.size > 10 * 1024 * 1024) {
        toast({ variant: 'error', title: 'File too large', description: 'Maximum file size is 10MB' });
        e.target.value = '';
        return;
      }
      try {
        await uploadConfig.mutateAsync({ projectId: id, type: uploadType, file });
        toast({ variant: 'success', title: `${uploadType} uploaded`, description: file.name });
      } catch (err) {
        toast({ variant: 'error', title: 'Upload failed', description: err instanceof Error ? err.message : String(err) });
      }
      e.target.value = '';
    },
    [id, configType, uploadConfig],
  );

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

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <AlertCircle className="h-10 w-10 text-danger" />
        <p className="text-sm text-muted-foreground">Project not found</p>
        <button
          onClick={() => navigate('/projects')}
          className="text-sm text-primary underline"
        >
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-6">
      {/* Header */}
      <PageHeader
        leading={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/projects')}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <FolderKanban className="h-6 w-6 text-primary" />
          </div>
        }
        title={project.name}
        subtitle={project.description}
        actions={
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeleteProject(true)}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Delete
          </Button>
        }
      />

      {/* Tabs */}
      <Tabs<Tab>
        items={[
          { id: 'codebases', label: 'Codebases', icon: <GitBranch className="h-4 w-4" /> },
          { id: 'artifacts', label: 'Project Customization', icon: <FileText className="h-4 w-4" /> },
          { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* Tab Content */}
      {tab === 'codebases' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Linked Repositories</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowAddCodebase(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Add Repository
            </Button>
          </div>

          {/* Add Codebase Form */}
          {showAddCodebase && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Add New Repository</h3>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowAddCodebase(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-muted-foreground">Alias*</label>
                  <Input
                    type="text"
                    value={cbAlias}
                    onChange={(e) => setCbAlias(e.target.value)}
                    className="mt-0.5 text-xs"
                    placeholder="frontend"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground">Type</label>
                  <Select
                    value={cbType}
                    onChange={(v) => setCbType(v as CodebaseType)}
                    className="mt-0.5"
                    options={[
                      { value: 'git-remote', label: 'Remote Git Repo' },
                      { value: 'git-local', label: 'Local Git Repo' },
                      { value: 'local-dir', label: 'Local Directory' },
                    ]}
                  />
                </div>
              </div>
              {cbType === 'git-remote' ? (
                <div>
                  <label className="block text-[10px] text-muted-foreground">Repository URL*</label>
                  <Input
                    type="text"
                    value={cbUrl}
                    onChange={(e) => setCbUrl(e.target.value)}
                    className="mt-0.5 text-xs font-mono"
                    placeholder="https://github.com/org/repo.git"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] text-muted-foreground">Local Path*</label>
                  <Input
                    type="text"
                    value={cbLocalPath}
                    onChange={(e) => setCbLocalPath(e.target.value)}
                    className="mt-0.5 text-xs font-mono"
                    placeholder="/path/to/repo"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] text-muted-foreground">Default Branch</label>
                <Input
                  type="text"
                  value={cbBranch}
                  onChange={(e) => setCbBranch(e.target.value)}
                  className="mt-0.5 text-xs"
                  placeholder="main (optional)"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddCodebase}
                  disabled={!isCodebaseFormValid || linkCodebase.isPending}
                  loading={linkCodebase.isPending}
                >
                  Add Repository
                </Button>
              </div>
            </div>
          )}

          {/* Codebase List */}
          {(!codebases || codebases.length === 0) && !showAddCodebase && (
            <p className="text-sm text-muted-foreground">No repositories linked yet.</p>
          )}
          {codebases && codebases.length > 0 && (
            <div className="space-y-2">
              {codebases.map((cb) => (
                <div
                  key={cb.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-accent/50 cursor-pointer"
                  onClick={() => navigate(`/projects/${id}/codebases/${cb.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <GitBranch className="h-4 w-4 text-primary" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{cb.alias}</span>
                        {typeBadge(cb.type)}
                        {statusBadge(cb.status)}
                        {(cb.status === 'cloning' || cb.status === 'pending') && (
                          <Spinner size="xs" className="text-info" />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground font-mono">
                        {cb.url ?? cb.localPath ?? '—'}
                      </p>
                      {(cb.status === 'cloning' || cb.status === 'pending') && (
                        <p className="mt-0.5 text-[10px] text-info">
                          Cloning in progress — this may take a moment...
                        </p>
                      )}
                      {cb.lastFetchedAt && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Last fetched: {new Date(cb.lastFetchedAt).toLocaleString()}
                        </p>
                      )}
                      {cb.status === 'error' && cb.lastError && (
                        <p className="mt-0.5 text-[10px] text-danger max-w-md truncate">
                          Error: {cb.lastError}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLogViewCbId(cb.id);
                      }}
                      className={cn(
                        cb.status === 'error' ? 'text-danger hover:text-danger' : 'hover:text-primary',
                      )}
                      title={cb.status === 'error' ? 'View error logs' : 'View clone status'}
                    >
                      <ScrollText className="h-3.5 w-3.5" />
                    </Button>
                    {cb.type !== 'local-dir' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchCodebase.mutate(
                            { projectId: id!, codebaseId: cb.id },
                            {
                              onSuccess: () => toast({ variant: 'success', title: 'Sync complete', description: `"${cb.alias}" is up to date` }),
                              onError: (err) => toast({
                                variant: 'error',
                                title: 'Sync failed',
                                description: `Failed to fetch latest for "${cb.alias}"`,
                                logs: `Codebase: ${cb.alias}\nOperation: git fetch\n\nError:\n${err instanceof Error ? err.message : String(err)}`,
                                duration: 0,
                              }),
                            },
                          );
                        }}
                        disabled={fetchCodebase.isPending}
                        title="Sync / Fetch latest"
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', fetchCodebase.isPending && 'animate-spin')} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'codebase', id: cb.id }); }}
                      className="hover:bg-danger-muted hover:text-danger"
                      title="Delete codebase"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'artifacts' && (
        <div className="space-y-4">
          {/* Per-section hidden file inputs */}
          {/* @ts-expect-error webkitdirectory is non-standard but widely supported */}
          <input ref={skillsUploadRef} type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={(e) => handleConfigUpload(e, 'skill')} />
          <input ref={promptsUploadRef} type="file" className="hidden" accept=".md,.txt,.json" onChange={(e) => handleConfigUpload(e, 'prompt')} />
          <input ref={agentsUploadRef} type="file" className="hidden" accept=".md,.txt,.json,.yaml,.yml" onChange={(e) => handleConfigUpload(e, 'agent')} />

          {/* Category selector — horizontal segmented control (responsive, no inner scroller) */}
          <div className="flex flex-wrap gap-1.5">
            {ARTIFACT_CATEGORIES.map(({ key, label, icon: Icon }) => {
              const active = artifactCategory === key;
              return (
                <button
                  key={key}
                  onClick={() => setArtifactCategory(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-subtle hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Selected category catalog */}
          {artifactCategory === 'mcp' ? (
            <ProjectMcpCatalog projectId={id} onAddNew={() => setShowAddMcp(true)} />
          ) : (
            <ProjectArtifactCatalog
              projectId={id}
              category={artifactCategory}
              artifacts={(availableArtifacts ?? []).filter((a) => a.type === artifactCategory)}
              onUpload={() => {
                if (artifactCategory === 'skill') skillsUploadRef.current?.click();
                else if (artifactCategory === 'prompt') promptsUploadRef.current?.click();
                else agentsUploadRef.current?.click();
              }}
              onPreview={(a) => setPreviewArtifact(a)}
              onDelete={(a) => setDeleteTarget({ type: 'config', id: a.id })}
            />
          )}
        </div>
      )}

      {tab === 'settings' && <ProjectSettingsForm project={project} />}

      {/* Delete Confirmations */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.type === 'codebase' ? 'Delete Codebase' : `Delete ${deleteTarget?.type}`}
        description={
          deleteTarget?.type === 'codebase'
            ? 'This will permanently delete the codebase, remove its cloned data, and delete all associated worktrees. This action cannot be undone.'
            : `Are you sure you want to remove this ${deleteTarget?.type}?`
        }
        variant="destructive"
        confirmLabel={deleteTarget?.type === 'codebase' ? 'Delete Codebase' : 'Delete'}
        onConfirm={async () => {
          if (!deleteTarget || !id) return;
          if (deleteTarget.type === 'codebase') {
            try {
              await unlinkCodebase.mutateAsync({ projectId: id, codebaseId: deleteTarget.id });
              toast({ variant: 'success', title: 'Codebase deleted', description: 'Codebase and all worktrees have been removed' });
            } catch (err) {
              toast({
                variant: 'error',
                title: 'Failed to delete codebase',
                description: err instanceof Error ? err.message : String(err),
                logs: `Operation: Delete codebase\nCodebase ID: ${deleteTarget.id}\n\nError:\n${err instanceof Error ? err.message : String(err)}`,
                duration: 0,
              });
            }
          } else if (deleteTarget.type === 'config') {
            try {
              await deleteConfig.mutateAsync({ projectId: id, configId: deleteTarget.id });
              toast({ variant: 'success', title: 'Config deleted' });
            } catch (err) {
              toast({ variant: 'error', title: 'Failed to delete config', description: err instanceof Error ? err.message : String(err) });
            }
          }
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      />

      <ConfirmDialog
        open={showDeleteProject}
        title="Delete Project"
        description={`This will permanently delete "${project.name}" and all its codebases, configs, and worktrees. This action cannot be undone.`}
        variant="destructive"
        confirmLabel="Delete Project"
        onConfirm={async () => {
          try {
            await deleteProject.mutateAsync(id!);
            toast({ variant: 'success', title: 'Project deleted', description: `"${project.name}" has been deleted` });
            navigate('/projects');
          } catch (err) {
            toast({ variant: 'error', title: 'Failed to delete project', description: err instanceof Error ? err.message : String(err) });
            setShowDeleteProject(false);
          }
        }}
        onOpenChange={(open) => { if (!open) setShowDeleteProject(false); }}
      />

      {/* Artifact Preview Modal */}
      {previewArtifact && (
        <ArtifactPreviewModal
          artifact={previewArtifact}
          projectId={id}
          onClose={() => setPreviewArtifact(null)}
        />
      )}

      {/* Add MCP Server Modal */}
      {showAddMcp && (
        <AddMcpServerModal
          projectId={id}
          onClose={() => setShowAddMcp(false)}
        />
      )}

      {/* Log Viewer Modal */}
      {logContent !== null && (
        <Modal
          open
          onClose={() => setLogViewCbId(null)}
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
// ProjectArtifactCatalog — Settings-styled catalog for one artifact
// category (skills / prompts / agents). System artifacts are available
// to the project by default; a per-row toggle (client preference) turns
// them off for this project. Project artifacts are uploaded here and can
// be previewed / deleted. Rows use the shared CatalogAccordionRow.
// ────────────────────────────────────────────────────────────────

function ProjectArtifactCatalog({
  projectId,
  category,
  artifacts,
  onUpload,
  onPreview,
  onDelete,
}: {
  projectId: string | undefined;
  category: ArtifactCategory;
  artifacts: ArtifactWithSource[];
  onUpload: () => void;
  onPreview: (a: ArtifactWithSource) => void;
  onDelete: (a: ArtifactWithSource) => void;
}) {
  const catMeta = ARTIFACT_CATEGORIES.find((c) => c.key === category)!;
  // Subscribe to the disabled array (not the stable isDisabled fn) so toggles re-render.
  const disabledKeys = useProjectCatalogPrefsStore((s) => s.disabled);
  const setEnabled = useProjectCatalogPrefsStore((s) => s.setEnabled);
  const isOff = (aid: string) => !!projectId && disabledKeys.includes(`${projectId}:${aid}`);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return artifacts;
    const s = q.toLowerCase();
    return artifacts.filter((a) => a.name.toLowerCase().includes(s) || (a.description ?? '').toLowerCase().includes(s));
  }, [artifacts, q]);

  const enabledCount = artifacts.filter((a) => !isOff(a.id)).length;

  const uploadLabel = category === 'skill' ? 'Upload Skill Folder' : `Add ${catMeta.label.replace(/s$/, '')}`;

  return (
    <div>
      <SectionListHeader
        title={`${enabledCount} of ${artifacts.length} enabled`}
        action={
          <div className="flex items-center gap-2">
            <div className="w-[12rem]"><SearchInput value={q} onChange={setQ} placeholder={`Search ${catMeta.label.toLowerCase()}…`} /></div>
            <Button
              variant="primary"
              size="sm"
              onClick={onUpload}
              leftIcon={category === 'skill' ? <FolderUp className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
            >
              {uploadLabel}
            </Button>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <catMeta.icon className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No {catMeta.label.toLowerCase()} {q.trim() ? 'match your search' : 'yet'}.</p>
          {!q.trim() && (
            <Button variant="secondary" size="sm" className="mt-1" onClick={onUpload} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              {uploadLabel}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((a) => {
            const enabled = !isOff(a.id);
            const isSystem = a.source === 'system';
            return (
              <CatalogAccordionRow
                key={a.id}
                icon={isSystem ? <Shield className="h-4 w-4 text-info" /> : <catMeta.icon className="h-4 w-4 text-primary" />}
                title={a.name}
                badge={<Badge tone={isSystem ? 'neutral' : 'success'} size="sm" className="shrink-0 capitalize">{a.source}</Badge>}
                subtitle={a.description}
                disabled={!enabled}
                expanded={expanded === a.id}
                onToggleExpanded={() => setExpanded((cur) => (cur === a.id ? null : a.id))}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(on) => projectId && setEnabled(projectId, a.id, on)}
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${a.name} for this project`}
                  />
                }
              >
                <div className="rounded-md border border-border bg-card px-3 py-2.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</div>
                  <p className="text-xs leading-relaxed text-foreground break-words">
                    {a.description || `No description provided for this ${category}.`}
                  </p>
                </div>
                <div className="mt-2.5 flex items-center justify-end gap-2">
                  {a.source === 'project' && (
                    <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => onDelete(a)}>
                      <span className="text-danger">Delete</span>
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => onPreview(a)}>
                    Preview full details
                  </Button>
                </div>
              </CatalogAccordionRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// ProjectMcpCatalog — Settings-styled MCP catalog for a project.
// System servers are available by default (toggle to disable per
// project); project servers are added here and can be deleted. Retains
// the mcp.json view and the All / System / Project scope filter.
// ────────────────────────────────────────────────────────────────

function ProjectMcpCatalog({
  projectId,
  onAddNew,
}: {
  projectId: string | undefined;
  onAddNew: () => void;
}) {
  const { data: projectServers } = useProjectMcpServers(projectId);
  const { data: systemServers } = useSystemMcpServers();
  const deleteMcp = useDeleteMcpServer();
  // Subscribe to the disabled array (not the stable isDisabled fn) so toggles re-render.
  const disabledKeys = useProjectCatalogPrefsStore((s) => s.disabled);
  const setEnabled = useProjectCatalogPrefsStore((s) => s.setEnabled);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'system' | 'project'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'json'>('list');
  const [expanded, setExpanded] = useState<string | null>(null);

  const allProject = (projectServers as McpServerEntry[]) ?? [];
  const allSystem = (systemServers as McpServerEntry[]) ?? [];
  const allServers = [...allProject, ...allSystem];
  const displayServers = scope === 'system' ? allSystem : scope === 'project' ? allProject : allServers;

  const serverId = (srv: McpServerEntry) => srv.id ?? srv.name;
  const isOff = (sid: string) => !!projectId && disabledKeys.includes(`${projectId}:${sid}`);
  const enabledCount = allServers.filter((s) => !isOff(serverId(s))).length;

  /** Convert server entries to mcp.json format. */
  const toMcpJson = (servers: McpServerEntry[]): object => {
    const serversObj: Record<string, object> = {};
    for (const srv of servers) {
      const key = srv.name.toLowerCase().replace(/\s+/g, '-');
      serversObj[key] = srv.serverType === 'http'
        ? { type: 'http', url: srv.url ?? '', ...(srv.description ? { description: srv.description } : {}) }
        : { type: 'stdio', command: srv.command ?? 'npx', args: srv.args ?? [], ...(srv.description ? { description: srv.description } : {}) };
    }
    return { servers: serversObj };
  };

  return (
    <div>
      <SectionListHeader
        title={`${enabledCount} of ${allServers.length} enabled`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={cn('flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors', viewMode === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="h-3 w-3" /> List
              </button>
              <button
                onClick={() => setViewMode('json')}
                className={cn('flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors', viewMode === 'json' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                <Code2 className="h-3 w-3" /> JSON
              </button>
            </div>
            <Button variant="primary" size="sm" onClick={onAddNew} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Add server
            </Button>
          </div>
        }
      />

      {/* Scope filter */}
      <div className="mb-3 flex items-center gap-1.5">
        {(['all', 'system', 'project'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setScope(t)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
              scope === t ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-subtle',
            )}
          >
            {t === 'all' ? `All (${allServers.length})` : t === 'system' ? `System (${allSystem.length})` : `Project (${allProject.length})`}
          </button>
        ))}
      </div>

      {displayServers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <Server className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No MCP servers in this scope</p>
          <Button variant="secondary" size="sm" className="mt-1" onClick={onAddNew} leftIcon={<Plus className="h-3.5 w-3.5" />}>
            Add server
          </Button>
        </div>
      ) : viewMode === 'json' ? (
        <div className="hljs overflow-hidden rounded-lg border border-border">
          <SyntaxHighlightedCode code={JSON.stringify(toMcpJson(displayServers), null, 2)} language="json" fileName="mcp.json" showLineNumbers showCopyButton />
        </div>
      ) : (
        <div className="grid gap-2">
          {displayServers.map((srv) => {
            const sid = serverId(srv);
            const src = (srv as { source?: string }).source ?? 'project';
            const isSystem = src === 'system';
            const enabled = !isOff(sid);
            const isHttp = srv.serverType === 'http';
            const Icon = isHttp ? Globe : Server;
            return (
              <CatalogAccordionRow
                key={sid}
                icon={<Icon className={cn('h-4 w-4', isHttp ? 'text-info' : 'text-primary')} />}
                title={srv.name}
                badge={
                  <span className="flex items-center gap-1.5">
                    <Badge tone="neutral" size="sm" className="shrink-0 uppercase">{srv.serverType}</Badge>
                    <Badge tone={isSystem ? 'neutral' : 'success'} size="sm" className="shrink-0 capitalize">{src}</Badge>
                  </span>
                }
                subtitle={srv.serverType === 'http' ? srv.url : `${srv.command ?? ''} ${(srv.args ?? []).join(' ')}`.trim()}
                disabled={!enabled}
                expanded={expanded === sid}
                onToggleExpanded={() => setExpanded((cur) => (cur === sid ? null : sid))}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(on) => projectId && setEnabled(projectId, sid, on)}
                    aria-label={`${enabled ? 'Disable' : 'Enable'} ${srv.name} for this project`}
                  />
                }
              >
                <div className="space-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-xs">
                  {srv.description && <p className="text-muted-foreground break-words">{srv.description}</p>}
                  <div className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">Type</span><span className="text-foreground">{srv.serverType}</span></div>
                  {srv.url && <div className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">URL</span><span className="min-w-0 break-words font-mono text-foreground">{srv.url}</span></div>}
                  {srv.command && <div className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">Command</span><span className="min-w-0 break-words font-mono text-foreground">{srv.command}</span></div>}
                  {srv.args && srv.args.length > 0 && <div className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">Args</span><span className="min-w-0 break-words font-mono text-foreground">{srv.args.join(' ')}</span></div>}
                  <div className="flex gap-2"><span className="w-20 shrink-0 text-muted-foreground">Source</span><span className="text-foreground">{src}</span></div>
                  {src === 'project' && (
                    <div className="pt-1">
                      <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={() => setDeleteId(srv.id)}>
                        <span className="text-danger">Remove</span>
                      </Button>
                    </div>
                  )}
                </div>
              </CatalogAccordionRow>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Remove MCP Server"
        description="Remove this MCP server from the project?"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteId || !projectId) return;
          await deleteMcp.mutateAsync({ projectId, serverId: deleteId });
          setDeleteId(null);
        }}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// ArtifactPreviewModal — Single artifact preview popup with line numbers
// ────────────────────────────────────────────────────────────────

function ArtifactPreviewModal({
  artifact,
  projectId,
  onClose,
}: {
  artifact: ArtifactWithSource;
  projectId: string | undefined;
  onClose: () => void;
}) {
  const { data: content, isLoading, error } = useArtifactContent(
    projectId,
    artifact.id,
    artifact.source,
  );
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState('');
  const updateContent = useUpdateArtifactContent();

  useEffect(() => {
    if (content !== undefined) setEditContent(content);
  }, [content]);

  const handleSave = async () => {
    if (artifact.source !== 'project' || !projectId) return;
    await updateContent.mutateAsync({ projectId, configId: artifact.id, content: editContent });
    setEditMode(false);
  };

  const ext = artifact.filePath?.split('.').pop() ?? artifact.name.split('.').pop() ?? '';
  const isMarkdown = ext === 'md' || ext === 'mdx';

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{artifact.name}</span>
          <SourceBadge source={artifact.source} />
          {!isMarkdown && ext && (
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
              {extToLang(ext)}
            </span>
          )}
        </span>
      }
      footer={
        artifact.source === 'project' ? (
          editMode ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditMode(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                loading={updateContent.isPending}
                leftIcon={<Save className="h-3 w-3" />}
              >
                Save
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setEditMode(true); setEditContent(content ?? ''); }}
              leftIcon={<Pencil className="h-3 w-3" />}
            >
              Edit
            </Button>
          )
        ) : undefined
      }
    >
      {/* Content — full-bleed inside the Modal body */}
      <div className="-mx-5 -my-4 h-[calc(100%+2rem)] overflow-auto">
        {isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner size="lg" className="text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="px-6 py-4 text-sm text-danger">Failed to load: {(error as Error).message}</p>
        )}
        {!isLoading && !error && content !== undefined && (
          editMode ? (
            <textarea
              className="h-full w-full resize-none bg-background px-6 py-4 font-mono text-xs text-foreground focus:outline-none"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
            />
          ) : isMarkdown ? (
            <div className="px-6 py-4">
              <MarkdownRenderer content={content} className="max-w-none" />
            </div>
          ) : (
            <div className="hljs">
              <SyntaxHighlightedCode
                code={content}
                fileName={artifact.filePath ?? artifact.name}
                showLineNumbers
                showCopyButton
              />
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────
// AddMcpServerModal — Form to add a new project MCP server
// ────────────────────────────────────────────────────────────────

function AddMcpServerModal({
  projectId,
  onClose,
}: {
  projectId: string | undefined;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serverType, setServerType] = useState<'http' | 'stdio'>('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const createMcp = useCreateMcpServer();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !name.trim()) return;
    await createMcp.mutateAsync({
      projectId,
      data: {
        name: name.trim(),
        description: description.trim() || undefined,
        serverType,
        url: serverType === 'http' ? url.trim() : undefined,
        command: serverType === 'stdio' ? command.trim() : undefined,
        args: serverType === 'stdio' ? args.split(' ').filter(Boolean) : undefined,
      },
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          Add MCP Server
        </span>
      }
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-mcp-server-form"
            variant="primary"
            loading={createMcp.isPending}
          >
            Add Server
          </Button>
        </>
      }
    >
      <form id="add-mcp-server-form" onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My GitHub MCP"
              required
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Server Type</label>
            <Select
              value={serverType}
              onChange={(v) => setServerType(v as 'http' | 'stdio')}
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'stdio', label: 'STDIO (local process)' },
              ]}
            />
          </div>
          {serverType === 'http' ? (
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">URL *</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com"
                className="font-mono"
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Command *</label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="font-mono"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-0.5">Args (space-separated)</label>
                <Input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-github"
                  className="font-mono"
                />
              </div>
            </>
          )}
      </form>
    </Modal>
  );
}
