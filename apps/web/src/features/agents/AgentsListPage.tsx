// ────────────────────────────────────────────────────────────────
// AgentsListPage (P5-07; T-01 ListPage — grid variant; 04-screen-map.md §2.2
// Agents, §4.6 parity checklist #52) — the catalog of first-class agents.
//
// Agents come from three scopes: `system` (bundled, read-only), `global`
// (user-authored, everywhere) and `project` (one project). A project agent
// SHADOWS a global one with the same slug, and global shadows system — but
// this page lists the RAW rows so an author can see and edit the thing being
// shadowed. The catalog is small and changes rarely (`useAgents` caches it
// generously), so search/scope/role filtering runs client-side over the
// full list rather than round-tripping the server per keystroke.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Agent, AgentRole, AgentScope } from '@generatorai/shared';
import { useAgents, useDeleteAgent, useExportAgent, useImportAgent } from '@/hooks/agentQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { warningText } from '@/lib/agentCopy.js';
import { AgentGlyph } from '@/ui/primitives/AgentGlyph/AgentGlyph.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { FileInput } from '@/ui/primitives/FileInput/FileInput.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Skeleton } from '@/ui/primitives/Skeleton/Skeleton.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { CardGrid, EntityCard } from '@/ui/patterns/EntityCard/EntityCard.js';
import { FilterBar } from '@/ui/patterns/FilterBar/FilterBar.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';
import { ListPage } from '@/ui/templates/ListPage/ListPage.js';
import { agentMetaLine, ROLE_LABEL, scopeMeta } from './agentListCopy.js';

type Scope = AgentScope | 'all';
const SCOPE_ITEMS: readonly Omit<SegmentedItem<Scope>, 'count'>[] = [
  { value: 'all', label: 'All' },
  { value: 'system', label: 'Built-in' },
  { value: 'global', label: 'Global' },
  { value: 'project', label: 'Project' },
];

const ROLE_OPTIONS: readonly { value: AgentRole | ''; label: string }[] = [
  { value: '', label: 'All roles' },
  { value: 'agent', label: 'Worker' },
  { value: 'orchestrator', label: 'Orchestrator' },
];

// The server's hard cap on an `.agent.md` document; fail fast client-side so
// a stray binary never becomes a 100MB request body.
const MAX_IMPORT_BYTES = 256 * 1024;

type AgentSort = 'name' | 'updated';
/** Board Agents: a sort chip after the filters ("Name"). */
const AGENT_SORTS: Record<AgentSort, { label: string; compare: (a: Agent, b: Agent) => number }> = {
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  updated: { label: 'Updated', compare: (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() },
};

export function AgentsListPage() {
  const navigate = useNavigate();
  const { data: agents, isLoading, isError, error, refetch } = useAgents();
  const { data: projects } = useProjects();
  const deleteAgent = useDeleteAgent();
  const exportAgent = useExportAgent();
  const importAgent = useImportAgent();
  const confirmer = useConfirm();

  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [role, setRole] = useState<AgentRole | ''>('');
  const [sort, setSort] = useState<AgentSort>('name');

  const projectsById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);

  const scopeItems: SegmentedItem<Scope>[] = SCOPE_ITEMS.map((item) => ({
    ...item,
    count: agents ? (item.value === 'all' ? agents.length : agents.filter((a) => a.scope === item.value).length) : undefined,
  }));

  const filtered = useMemo(() => {
    if (!agents) return [];
    const q = search.trim().toLowerCase();
    return agents.filter((a) => {
      if (scope !== 'all' && a.scope !== scope) return false;
      if (role && a.role !== role) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
      );
    }).sort(AGENT_SORTS[sort].compare);
  }, [agents, search, scope, role, sort]);

  const hasFilters = Boolean(search) || scope !== 'all' || role !== '';
  const clearFilters = () => {
    setSearch('');
    setScope('all');
    setRole('');
  };

  const handleImportFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error('Agent file is too large', { description: 'The limit is 256 KB.' });
      return;
    }
    try {
      const markdown = await file.text();
      const created = await importAgent.mutateAsync({ markdown, scope: 'global' });
      for (const w of created.warnings ?? []) toast.info(warningText(w));
      navigate(`/agents/${created.id}`);
    } catch (err) {
      toast.error('Import failed', { description: err instanceof Error ? err.message : String(err) });
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
      toast.error(`Couldn't export "${agent.name}"`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDelete = async (agent: Agent) => {
    const ok = await confirmer.confirm({
      title: `Delete "${agent.name}"?`,
      description:
        'Chats and stages already bound to this agent keep their frozen snapshot and continue to run. New bindings will no longer see it.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      // Always `force`: the dialog above already states what happens to
      // existing bindings, so a second 409 round-trip would only ask the
      // same question twice. The server still hard-deletes when nothing is
      // bound, and soft-deletes (disables) otherwise.
      await deleteAgent.mutateAsync({ id: agent.id, force: true });
    } catch (err) {
      toast.error(`Couldn't delete "${agent.name}"`, { description: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <ListPage
        header={<PageHeader title="Agents" />}
      title={
        <PageTitle
          title="Agents"
          count={agents ? agents.length : undefined}
          description="Reusable instructions with their own skills, MCP servers and capabilities"
          actions={
            <>
              <FileInput
                accept=".md,text/markdown"
                multiple={false}
                onFilesSelected={(files) => {
                  const file = files[0];
                  if (file) void handleImportFile(file);
                }}
              >
                {(open) => (
                  <Button
                    variant="secondary"
                    icon="upload"
                    loading={importAgent.isPending}
                    onClick={open}
                    data-testid="agent-import-button"
                  >
                    Import <span className="font-mono text-small text-fg-2">.agent.md</span>
                  </Button>
                )}
              </FileInput>
              <Button variant="primary" icon="plus" onClick={() => navigate('/agents/new')} data-testid="agent-create-button">
                New agent
              </Button>
            </>
          }
        />
      }
      filters={
        <FilterBar
          search={<SearchInput value={search} onValueChange={setSearch} label="Search agents" placeholder="Search agents" />}
          scope={<SegmentedControl value={scope} onValueChange={setScope} items={scopeItems} semantics="tabs" label="Agent scope" />}
          filters={
            <Menu.Root>
              <Menu.Trigger
                render={<Chip dropdown>{ROLE_OPTIONS.find((o) => o.value === role)?.label ?? 'Role'}</Chip>}
              />
              <Menu.Popup>
                <Menu.RadioGroup value={role} onValueChange={(next) => setRole(next as AgentRole | '')}>
                  {ROLE_OPTIONS.map((option) => (
                    <Menu.RadioItem key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Root>
          }
          sort={
            <Menu.Root>
              <Menu.Trigger render={<Chip dropdown icon="sort">{AGENT_SORTS[sort].label}</Chip>} />
              <Menu.Popup align="end">
                <Menu.RadioGroup value={sort} onValueChange={(next) => setSort(next as AgentSort)}>
                  {(Object.keys(AGENT_SORTS) as AgentSort[]).map((key) => (
                    <Menu.RadioItem key={key} value={key}>
                      {AGENT_SORTS[key].label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Root>
          }
        />
      }
      footer={
        filtered.length > 0
          ? 'Built-in agents are read-only — export one and import the .agent.md to edit a copy. A chat keeps the agent it started with, even after it is edited or deleted.'
          : undefined
      }
      content={
        isLoading ? (
          <AgentsGridSkeleton />
        ) : isError ? (
          <EmptyState
            tone="error"
            icon="warning"
            title="Couldn't load agents"
            description={error instanceof Error ? error.message : String(error)}
            action={
              <Button size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="agents"
            title={hasFilters ? 'No agents match your filters' : 'No agents yet'}
            description={
              hasFilters
                ? 'No agents match your filters.'
                : 'Create an agent to bundle instructions with a fixed set of skills, MCP servers and capabilities.'
            }
            action={
              hasFilters ? (
                <Button size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon="plus" onClick={() => navigate('/agents/new')}>
                  New agent
                </Button>
              )
            }
          />
        ) : (
          <CardGrid columns={3} data-testid="agent-grid">
            {filtered.map((agent) => {
              const readOnly = agent.scope === 'system';
              return (
                <EntityCard
                  key={agent.id}
                  // Not role="button": the card holds its own buttons (nested-interactive,
                  // and the card's name swallowed theirs). Keyboard users open it with the
                  // View/Edit button; a pointer click anywhere on the card still opens it.
                  data-testid={`agent-card-${agent.slug}`}
                  // Opacity would also wash out the "Disabled" badge's and
                  // the description's text below the 4.5:1 contrast floor
                  // (caught on the CapabilityToggleList a11y story) — the
                  // Badge alone signals the state.
                  className="cursor-pointer"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  leading={
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-card bg-selected">
                      <AgentGlyph size={16} />
                    </span>
                  }
                  title={agent.name}
                  badge={
                    <span className="flex shrink-0 items-center gap-1">
                      <Badge>{ROLE_LABEL[agent.role]}</Badge>
                      {!agent.enabled ? <Badge tone="warn">Disabled</Badge> : null}
                    </span>
                  }
                  actions={
                    <>
                      <IconButton
                        icon={readOnly ? 'view' : 'edit'}
                        label={readOnly ? `View ${agent.name}` : `Edit ${agent.name}`}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/agents/${agent.id}`);
                        }}
                      />
                      <IconButton
                        icon="download"
                        label={`Export ${agent.name}`}
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleExport(agent);
                        }}
                      />
                      {!readOnly ? (
                        <IconButton
                          icon="trash"
                          label={`Delete ${agent.name}`}
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(agent);
                          }}
                        />
                      ) : null}
                    </>
                  }
                  description={agent.description}
                  meta={agentMetaLine(agent)}
                  footer={
                    <>
                      <span className="min-w-0 flex-1 truncate text-small text-fg-3">
                        {scopeMeta(agent, agent.projectId ? projectsById.get(agent.projectId) : undefined)}
                      </span>
                      {agent.tags.slice(0, 2).map((tag) => (
                        <Chip key={tag} size="sm">
                          {tag}
                        </Chip>
                      ))}
                      <span className="shrink-0 font-mono text-micro text-fg-3">v{agent.version}</span>
                    </>
                  }
                />
              );
            })}
          </CardGrid>
          )
        }
      />
      {confirmer.dialog}
    </>
  );
}

function AgentsGridSkeleton() {
  return (
    <div role="status" aria-busy aria-label="Loading agents" className="grid grid-cols-3 gap-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card border border-line-soft bg-raised p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton shape="block" className="size-8" />
            <Skeleton width="60%" />
          </div>
          <Skeleton shape="meta" />
          <Skeleton shape="meta" width="80%" />
        </div>
      ))}
    </div>
  );
}
