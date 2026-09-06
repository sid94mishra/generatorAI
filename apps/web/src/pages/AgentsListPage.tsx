// ────────────────────────────────────────────────────────────────
// AgentsListPage — catalog of first-class agents.
//
// Agents come from three scopes: `system` (bundled, read-only),
// `global` (user-authored, available everywhere) and `project`
// (scoped to one project). A project agent SHADOWS a global one with the
// same slug, and global shadows system — but this page shows the RAW rows
// so an author can see and edit the thing being shadowed.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Network,
  Plus,
  Upload,
  Download,
  Trash2,
  AlertCircle,
  Eye,
  FileText,
  Pencil,
  Server,
  Lock,
} from 'lucide-react';

import {
  useAgents,
  useDeleteAgent,
  useExportAgent,
  useImportAgent,
} from '@/hooks/agentQueries.js';
import { CardGridSkeleton } from '@/components/Skeleton.js';
import {
  SearchInput,
  EmptyState,
  Button,
  Input,
  Badge,
  PageHeader,
  Select,
  ConfirmDialog,
  toast,
} from '@/components/ui/index.js';
import { EntityCard } from '@/components/data/index.js';
import { PageContainer } from '@/components/layout/PageContainer.js';
import { Toolbar } from '@/components/layout/Toolbar.js';
import { SCOPE_LABELS, ROLE_LABELS, scopeTone, warningText } from '@/lib/agentCopy.js';
import type { Agent, AgentScope, AgentRole } from '@generatorai/shared';

export function AgentsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<AgentScope | ''>('');
  const [role, setRole] = useState<AgentRole | ''>('');

  const { data: agents, isLoading, error } = useAgents();
  const deleteAgent = useDeleteAgent();
  const exportAgent = useExportAgent();
  const importAgent = useImportAgent();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);

  const filtered = useMemo(() => {
    if (!agents) return [];
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (scope && a.scope !== scope) return false;
      if (role && a.role !== role) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [agents, search, scope, role]);

  const handleImportFile = async (file: File) => {
    // 256KB is the server's hard cap on an .agent.md document; fail fast
    // client-side so a stray binary never becomes a 100MB request body.
    if (file.size > 256 * 1024) {
      toast.error('Agent file is too large (max 256 KB)');
      return;
    }
    try {
      const markdown = await file.text();
      const created = await importAgent.mutateAsync({ markdown, scope: 'global' });
      for (const w of created.warnings ?? []) toast.warning(warningText(w));
      toast.success(`Imported "${created.name}"`);
      navigate(`/agents/${created.id}`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    }
  };

  const handleExport = async (agent: Agent) => {
    try {
      const markdown = await exportAgent.mutateAsync(agent.id);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${agent.slug}.agent.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    }
  };

  // Always `force`: the confirm dialog already states what happens to existing
  // bindings, so a second 409 round-trip would only ask the same question
  // twice. The server still hard-deletes when nothing is bound.
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      const result = await deleteAgent.mutateAsync({ id: pendingDelete.id, force: true });
      toast.success(
        result.soft
          ? `"${pendingDelete.name}" disabled — existing bindings keep their frozen snapshot`
          : `Deleted "${pendingDelete.name}"`,
      );
      setPendingDelete(null);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  if (isLoading) return <CardGridSkeleton count={6} />;
  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-danger">
        <AlertCircle className="h-8 w-8" />
        <p>Failed to load agents: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        className="mb-8"
        title="Agents"
        subtitle="Reusable instructions with their own skills, MCP servers and capabilities"
        actions={
          <div className="flex items-center gap-2">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".md,text/markdown"
              className="hidden"
              data-testid="agent-import-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImportFile(file);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={importAgent.isPending}
              leftIcon={<Upload className="h-4 w-4" />}
              data-testid="agent-import-button"
            >
              Import
            </Button>
            <Button
              onClick={() => navigate('/agents/new')}
              leftIcon={<Plus className="h-4 w-4" />}
              data-testid="agent-create-button"
            >
              New agent
            </Button>
          </div>
        }
      />

      <Toolbar className="mb-6 flex-wrap sm:flex-nowrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search agents by name, slug, description or tag…"
          aria-label="Search agents"
          className="min-w-0 flex-1"
        />
        <Select
          aria-label="Filter by scope"
          value={scope}
          onChange={(v) => setScope(v as AgentScope | '')}
          options={[
            { value: '', label: 'All scopes' },
            { value: 'system', label: 'Built-in' },
            { value: 'global', label: 'Global' },
            { value: 'project', label: 'Project' },
          ]}
        />
        <Select
          aria-label="Filter by role"
          value={role}
          onChange={(v) => setRole(v as AgentRole | '')}
          options={[
            { value: '', label: 'All roles' },
            { value: 'agent', label: 'Agent' },
            { value: 'orchestrator', label: 'Orchestrator' },
          ]}
        />
      </Toolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-12 w-12" />}
          title={search || scope || role ? 'No agents match your filters' : 'No agents yet'}
          hint="Create an agent to bundle instructions with a fixed set of skills, MCP servers and capabilities."
          action={
            <Button onClick={() => navigate('/agents/new')} leftIcon={<Plus className="h-4 w-4" />}>
              New agent
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="agent-grid">
          {filtered.map((agent) => {
            const readOnly = agent.scope === 'system';
            return (
              <EntityCard
                key={agent.id}
                data-testid={`agent-card-${agent.slug}`}
                accent={agent.role === 'orchestrator'}
                icon={
                  agent.role === 'orchestrator' ? (
                    <Network className="h-5 w-5" />
                  ) : (
                    <Bot className="h-5 w-5" />
                  )
                }
                title={
                  // EntityCard truncates its <h3>, but an inner flex container
                  // defeats that: the flex item needs its own min-w-0/truncate
                  // or a long name is clipped mid-word with no ellipsis.
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{agent.name}</span>
                    {!agent.enabled && (
                      <Badge tone="warning" size="sm" className="shrink-0">
                        Disabled
                      </Badge>
                    )}
                  </span>
                }
                description={agent.description}
                onClick={() => navigate(`/agents/${agent.id}`)}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/agents/${agent.id}`);
                      }}
                      className="h-auto w-auto rounded-lg bg-subtle p-2 text-muted-foreground transition-colors hover:text-foreground"
                      title={readOnly ? 'View agent' : 'Edit agent'}
                      aria-label={`${readOnly ? 'View' : 'Edit'} ${agent.name}`}
                    >
                      {readOnly ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleExport(agent);
                      }}
                      className="h-auto w-auto rounded-lg bg-subtle p-2 text-muted-foreground transition-colors hover:text-foreground"
                      title="Export as .agent.md"
                      aria-label={`Export ${agent.name}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(agent);
                        }}
                        className="h-auto w-auto rounded-lg bg-danger-muted p-2 text-danger transition-colors hover:bg-danger/20"
                        title="Delete agent"
                        aria-label={`Delete ${agent.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                }
                meta={
                  <>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {agent.skillIds.length} skills
                    </span>
                    <span className="flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      {agent.mcpServerIds.length} MCP
                    </span>
                    <span>v{agent.version}</span>
                  </>
                }
              >
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={scopeTone(agent.scope)} size="sm">
                    {readOnly && <Lock className="h-2.5 w-2.5" />}
                    {SCOPE_LABELS[agent.scope]}
                  </Badge>
                  <Badge tone={agent.role === 'orchestrator' ? 'primary' : 'neutral'} size="sm">
                    {ROLE_LABELS[agent.role]}
                  </Badge>
                  {agent.runtime.model && (
                    <Badge tone="neutral" size="sm">
                      {agent.runtime.model}
                    </Badge>
                  )}
                  {agent.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} tone="neutral" size="sm">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </EntityCard>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        description="Chats and stages already bound to this agent keep their frozen snapshot and continue to run. New bindings will no longer see it."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteAgent.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </PageContainer>
  );
}
