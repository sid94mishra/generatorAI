// ────────────────────────────────────────────────────────────────
// ProjectDetail · Customization (P5-04; board ProjectCustomization;
// F-projects-07; 04 §4.5 #48; G-19).
//
// Seg Skills / Prompts / Agents / MCP (`?kind=`, R-3) + "n of m enabled" +
// filter + Upload (skills upload a folder with SKILL.md) or Add server; the
// ArtifactsTable (Name · Source · Enabled · menu); a row opens the 400px
// preview. Enable switches write the project's server-side prefs (G-19), so
// they follow the user to every device and apply to chats and runs in this
// project — the device-local store they replace is gone.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ArtifactWithSource, ConfigType, McpServerEntry, ProjectArtifactPrefEntry } from '@generatorai/shared';
import {
  useDeleteConfig,
  useDeleteMcpServer,
  useProjectArtifactPrefs,
  useProjectConfigs,
  useProjectMcpServers,
  useSystemArtifacts,
  useSystemMcpServers,
  useUpdateProjectArtifactPrefs,
  useUploadConfig,
} from '@/hooks/projectQueries.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { MenuButton } from '@/ui/patterns/MenuButton/MenuButton.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { FileInput } from '@/ui/primitives/FileInput/FileInput.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { AddMcpServerDialog } from './AddMcpServerDialog.js';
import { ArtifactPreview } from './ArtifactPreview.js';
import {
  KIND_LABEL,
  KIND_PARAM,
  kindFromParam,
  mergeArtifacts,
  prefKey,
  skillFolderProblem,
  toggleDisabled,
  type ArtifactKind,
  type CustomizationKind,
} from './artifactModel.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_ACCEPT: Record<ArtifactKind, string | undefined> = {
  skill: undefined,
  prompt: '.md,.txt,.json',
  agent: '.md,.txt,.json,.yaml,.yml',
};
const KINDS: readonly CustomizationKind[] = ['skill', 'prompt', 'agent', 'mcp'];

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge tone={source === 'project' ? 'ok' : 'neutral'} className="capitalize">
      {source}
    </Badge>
  );
}

/** The G-19 prefs plus a setter that writes the whole disabled set. */
function useEnablement(projectId: string) {
  const { data: prefs } = useProjectArtifactPrefs(projectId);
  const update = useUpdateProjectArtifactPrefs();
  const disabled: readonly ProjectArtifactPrefEntry[] = useMemo(() => prefs?.disabled ?? [], [prefs]);
  const off = useMemo(() => new Set(disabled.map((d) => prefKey(d.type, d.id))), [disabled]);
  const setEnabled = (type: ConfigType, id: string, enabled: boolean) =>
    update.mutate(
      { projectId, prefs: { disabled: toggleDisabled(disabled, type, id, enabled) } },
      { onError: (err) => toast.error("Couldn't update the project's customization", { description: String(err) }) },
    );
  return { ready: prefs !== undefined, isEnabled: (type: ConfigType, id: string) => !off.has(prefKey(type, id)), setEnabled };
}

export function CustomizationTab({ projectId }: { projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = kindFromParam(searchParams.get('kind'));
  const setKind = (next: CustomizationKind) => {
    const params = new URLSearchParams(searchParams);
    params.set('kind', KIND_PARAM[next]);
    setSearchParams(params, { replace: true });
  };

  const system = useSystemArtifacts();
  const configs = useProjectConfigs(projectId);
  const projectMcp = useProjectMcpServers(projectId);
  const systemMcp = useSystemMcpServers();
  const enablement = useEnablement(projectId);

  const artifacts = useMemo(
    () => ({
      skill: mergeArtifacts(system.data ?? [], configs.data ?? [], 'skill'),
      prompt: mergeArtifacts(system.data ?? [], configs.data ?? [], 'prompt'),
      agent: mergeArtifacts(system.data ?? [], configs.data ?? [], 'agent'),
    }),
    [system.data, configs.data],
  );
  const mcpServers = useMemo(
    () => [...((projectMcp.data as McpServerEntry[] | undefined) ?? []), ...((systemMcp.data as McpServerEntry[] | undefined) ?? [])],
    [projectMcp.data, systemMcp.data],
  );
  const counts: Record<CustomizationKind, number> = {
    skill: artifacts.skill.length,
    prompt: artifacts.prompt.length,
    agent: artifacts.agent.length,
    mcp: mcpServers.length,
  };

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl<CustomizationKind>
        value={kind}
        onValueChange={setKind}
        semantics="tabs"
        label="Customization kind"
        className="self-start"
        items={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], count: counts[k] }))}
      />
      {kind === 'mcp' ? (
        <McpPanel key="mcp" projectId={projectId} servers={mcpServers} loading={projectMcp.isLoading || systemMcp.isLoading} enablement={enablement} />
      ) : (
        <ArtifactPanel
          key={kind}
          projectId={projectId}
          kind={kind}
          artifacts={artifacts[kind]}
          loading={system.isLoading || configs.isLoading}
          enablement={enablement}
        />
      )}
    </div>
  );
}

type Enablement = ReturnType<typeof useEnablement>;

function ArtifactPanel({
  projectId,
  kind,
  artifacts,
  loading,
  enablement,
}: {
  projectId: string;
  kind: ArtifactKind;
  artifacts: ArtifactWithSource[];
  loading: boolean;
  enablement: Enablement;
}) {
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const upload = useUploadConfig();
  const deleteConfig = useDeleteConfig();
  const confirmer = useConfirm();
  const noun = KIND_LABEL[kind].toLowerCase();

  const q = filter.trim().toLowerCase();
  const rows = q
    ? artifacts.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q))
    : artifacts;
  const enabledCount = artifacts.filter((a) => enablement.isEnabled(a.type, a.id)).length;
  const selected = artifacts.find((a) => a.id === selectedId);

  const onFiles = async (list: FileList) => {
    const files = Array.from(list);
    if (kind === 'skill') {
      const problem = skillFolderProblem(files);
      if (problem) {
        toast.error('Not a skill folder', { description: problem });
        return;
      }
    }
    let uploaded = 0;
    for (const file of kind === 'skill' ? files : files.slice(0, 1)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is larger than 10 MB`, { description: 'It was skipped.' });
        continue;
      }
      try {
        await upload.mutateAsync({ projectId, type: kind, file });
        uploaded += 1;
      } catch (err) {
        toast.error(`Couldn't upload ${file.name}`, { description: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
    if (uploaded > 0) toast.done(kind === 'skill' ? `Skill uploaded (${uploaded} files)` : `${files[0]?.name} uploaded`);
  };

  const onDelete = async (artifact: ArtifactWithSource) => {
    const ok = await confirmer.confirm({
      title: `Delete ${artifact.name}?`,
      description: `This removes the ${kind} from this project. It can’t be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteConfig.mutate(
      { projectId, configId: artifact.id },
      {
        onSuccess: () => setSelectedId(null),
        onError: (err) => toast.error(`Couldn't delete ${artifact.name}`, { description: String(err) }),
      },
    );
  };

  const columns: DataTableColumn<ArtifactWithSource>[] = [
    {
      id: 'name',
      header: KIND_LABEL[kind].replace(/s$/, ''),
      width: 'minmax(200px,1fr)',
      cell: (a) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-small text-fg">{a.name}</span>
          {a.description ? <span className="truncate text-small text-fg-3">{a.description}</span> : null}
        </span>
      ),
    },
    { id: 'source', header: 'Source', width: 84, cell: (a) => <SourceBadge source={a.source} /> },
    {
      id: 'enabled',
      header: 'Enabled',
      width: 64,
      cell: (a) => {
        const on = enablement.isEnabled(a.type, a.id);
        return (
          <Switch
            checked={on}
            disabled={!enablement.ready}
            onCheckedChange={(next) => enablement.setEnabled(a.type, a.id, next)}
            aria-label={`${a.name} enabled in this project`}
            onClick={(event) => event.stopPropagation()}
          />
        );
      },
    },
  ];

  return (
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-small text-fg-3">
            {enabledCount} of {artifacts.length} enabled
          </span>
          <div className="ml-auto w-48">
            <SearchInput value={filter} onValueChange={setFilter} label={`Filter ${noun}`} placeholder={`Filter ${noun}`} shortcut={null} />
          </div>
          <FileInput
            directory={kind === 'skill'}
            multiple={kind === 'skill'}
            accept={UPLOAD_ACCEPT[kind]}
            onFilesSelected={(files) => void onFiles(files)}
          >
            {(open) => (
              <Button icon="upload" loading={upload.isPending} onClick={open}>
                {kind === 'skill' ? 'Upload skill folder' : 'Upload'}
              </Button>
            )}
          </FileInput>
        </div>
        <DataTable<ArtifactWithSource>
          label={KIND_LABEL[kind]}
          columns={columns}
          rows={rows}
          getRowId={(a) => a.id}
          onRowClick={(a) => setSelectedId(a.id)}
          actionsWidth={40}
          rowActions={(a) => (
            <MenuButton
              label={`More actions for ${a.name}`}
              iconOnly
              icon="more"
              size="sm"
              items={[
                { id: 'preview', label: 'Preview', icon: 'view', onSelect: () => setSelectedId(a.id) },
                ...(a.source === 'project'
                  ? [
                      { type: 'separator' as const },
                      { id: 'delete', label: 'Delete…', icon: 'trash' as const, danger: true, onSelect: () => void onDelete(a) },
                    ]
                  : []),
              ]}
            />
          )}
          loading={loading}
          empty={
            <EmptyState
              framed
              icon={kind === 'skill' ? 'skills' : kind === 'agent' ? 'agents' : 'message'}
              title={q ? `No ${noun} match “${filter.trim()}”` : `No ${noun} yet`}
              description={q ? undefined : `Upload a ${KIND_LABEL[kind].replace(/s$/, '').toLowerCase()} to use it in this project.`}
            />
          }
        />
      </div>
      {selected ? (
        <ArtifactPreview projectId={projectId} artifact={selected} onClose={() => setSelectedId(null)} onDelete={(a) => void onDelete(a)} />
      ) : null}
      {confirmer.dialog}
    </div>
  );
}

/** The catalog as an `mcp.json` document (the JSON view). */
function toMcpJson(servers: readonly McpServerEntry[]): string {
  const out: Record<string, object> = {};
  for (const srv of servers) {
    const key = srv.name.toLowerCase().replace(/\s+/g, '-');
    out[key] =
      srv.serverType === 'stdio'
        ? { type: 'stdio', command: srv.command ?? '', args: srv.args ?? [], ...(srv.description ? { description: srv.description } : {}) }
        : { type: srv.serverType, url: srv.url ?? '', ...(srv.description ? { description: srv.description } : {}) };
  }
  return JSON.stringify({ servers: out }, null, 2);
}

function McpPanel({
  projectId,
  servers,
  loading,
  enablement,
}: {
  projectId: string;
  servers: McpServerEntry[];
  loading: boolean;
  enablement: Enablement;
}) {
  const [scope, setScope] = useState<'all' | 'system' | 'project'>('all');
  const [view, setView] = useState<'list' | 'json'>('list');
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const remove = useDeleteMcpServer();
  const confirmer = useConfirm();

  const isProject = (s: McpServerEntry) => s.source === 'project';
  const shown = servers.filter((s) => scope === 'all' || (scope === 'project' ? isProject(s) : !isProject(s)));
  const enabledCount = servers.filter((s) => enablement.isEnabled('mcp', s.id)).length;
  const selected = servers.find((s) => s.id === selectedId);

  const onRemove = async (srv: McpServerEntry) => {
    const ok = await confirmer.confirm({ title: `Remove ${srv.name}?`, description: 'Remove this MCP server from the project?', confirmLabel: 'Remove' });
    if (!ok) return;
    remove.mutate(
      { projectId, serverId: srv.id },
      {
        onSuccess: () => setSelectedId(null),
        onError: (err) => toast.error(`Couldn't remove ${srv.name}`, { description: String(err) }),
      },
    );
  };

  const columns: DataTableColumn<McpServerEntry>[] = [
    {
      id: 'name',
      header: 'Server',
      width: 'minmax(200px,1fr)',
      cell: (s) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-small text-fg">{s.name}</span>
          <span className="truncate font-mono text-micro text-fg-3">
            {s.serverType === 'stdio' ? [s.command, ...(s.args ?? [])].filter(Boolean).join(' ') : s.url}
          </span>
        </span>
      ),
    },
    { id: 'type', header: 'Type', width: 64, cell: (s) => <Badge className="uppercase">{s.serverType}</Badge> },
    { id: 'source', header: 'Source', width: 84, cell: (s) => <SourceBadge source={s.source} /> },
    {
      id: 'enabled',
      header: 'Enabled',
      width: 64,
      cell: (s) => (
        <Switch
          checked={enablement.isEnabled('mcp', s.id)}
          disabled={!enablement.ready}
          onCheckedChange={(next) => enablement.setEnabled('mcp', s.id, next)}
          aria-label={`${s.name} enabled in this project`}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    },
  ];

  return (
    <div className="flex gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={scope}
            onValueChange={(v) => setScope(v as typeof scope)}
            label="Server scope"
            items={[
              { value: 'all', label: 'All', count: servers.length },
              { value: 'system', label: 'System', count: servers.filter((s) => !isProject(s)).length },
              { value: 'project', label: 'Project', count: servers.filter(isProject).length },
            ]}
          />
          <span className="text-small text-fg-3">
            {enabledCount} of {servers.length} enabled
          </span>
          <SegmentedControl
            className="ml-auto"
            value={view}
            onValueChange={(v) => setView(v as typeof view)}
            label="MCP view"
            items={[
              { value: 'list', label: 'List', icon: 'list' },
              { value: 'json', label: 'JSON', icon: 'file' },
            ]}
          />
          <Button icon="plus" onClick={() => setAdding(true)}>
            Add server
          </Button>
        </div>
        {view === 'json' ? (
          <CodeBlock lang="json" header="mcp.json" copy={toMcpJson(shown)} lineNumbers>
            {toMcpJson(shown)}
          </CodeBlock>
        ) : (
          <DataTable<McpServerEntry>
            label="MCP servers"
            columns={columns}
            rows={shown}
            getRowId={(s) => s.id}
            onRowClick={(s) => setSelectedId(s.id)}
            actionsWidth={40}
            rowActions={(s) =>
              isProject(s) ? (
                <MenuButton
                  label={`More actions for ${s.name}`}
                  iconOnly
                  icon="more"
                  size="sm"
                  items={[{ id: 'remove', label: 'Remove…', icon: 'trash', danger: true, onSelect: () => void onRemove(s) }]}
                />
              ) : null
            }
            loading={loading}
            empty={
              <EmptyState
                framed
                icon="mcp"
                title="No MCP servers in this scope"
                action={
                  <Button icon="plus" onClick={() => setAdding(true)}>
                    Add server
                  </Button>
                }
              />
            }
          />
        )}
      </div>
      {selected ? (
        <Card className="w-inspector shrink-0 self-start" data-testid="mcp-preview">
          <Card.Header action={<IconButton size="sm" icon="x" label="Close preview" onClick={() => setSelectedId(null)} />}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-mono text-ui font-semibold">{selected.name}</span>
              <SourceBadge source={selected.source} />
            </div>
          </Card.Header>
          <Card.Body>
            {selected.description ? <p className="text-small text-fg-2">{selected.description}</p> : null}
            <KeyValueList
              items={[
                { label: 'Type', value: selected.serverType.toUpperCase() },
                ...(selected.url ? [{ label: 'URL', value: selected.url, mono: true }] : []),
                ...(selected.command ? [{ label: 'Command', value: selected.command, mono: true }] : []),
                ...(selected.args?.length ? [{ label: 'Args', value: selected.args.join(' '), mono: true }] : []),
                { label: 'Source', value: selected.source },
              ]}
            />
          </Card.Body>
          {isProject(selected) ? (
            <div className="flex h-footer items-center border-t border-line-soft px-3.5">
              <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => void onRemove(selected)}>
                Remove
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
      <AddMcpServerDialog projectId={projectId} open={adding} onOpenChange={setAdding} />
      {confirmer.dialog}
    </div>
  );
}
