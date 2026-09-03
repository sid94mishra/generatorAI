// ────────────────────────────────────────────────────────────────
// Settings → Skills, MCP servers, and Templates catalogs.
// Flat single-level layout: a list header (count + search/add) sits
// directly above bordered accordion rows — no double-boxing.
// Skills + MCP toggle on/off (a client preference — see catalogPrefsStore);
// disabled entries are excluded everywhere the app offers them (chat `/`
// menu, artifact + MCP pickers) so they are never sent to models.
// MCP supports adding user-defined servers via an in-modal add sub-page,
// and Skills can open a full-details preview in place.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server, LayoutTemplate, Globe, Terminal, ChevronRight, Loader2,
  FileText, Plus, Trash2, ArrowLeft, X, Eye, AlertTriangle,
} from 'lucide-react';
import { useSystemArtifacts, useSystemMcpServers, useArtifactContent } from '@/hooks/projectQueries.js';
import { useTemplates } from '@/hooks/queries.js';
import { useCreateFromTemplate } from '@/hooks/workflowQueries.js';
import { Badge, Spinner, Button, SearchInput, Switch, Input } from '@/components/ui/index.js';
import { useSettingsUiStore } from '@/stores/settingsUiStore.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';
import { useCustomMcpStore, type CustomMcpServer, type CustomMcpTransport } from '@/stores/customMcpStore.js';
import { cn } from '@/lib/utils.js';
import type { ArtifactWithSource, McpServerEntry } from '@generatorai/shared';
import { SectionHeader, SectionListHeader, CatalogAccordionRow } from '../shared.js';

// ── Skills ──

export function SkillsSection() {
  const { data: skills, isLoading } = useSystemArtifacts('skill');
  const disabledSkills = useCatalogPrefsStore((s) => s.disabledSkills);
  const setSkillEnabled = useCatalogPrefsStore((s) => s.setSkillEnabled);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactWithSource | null>(null);

  const list = (skills ?? []) as ArtifactWithSource[];
  const filtered = useMemo(() => {
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((a) => a.name.toLowerCase().includes(s) || (a.description ?? '').toLowerCase().includes(s));
  }, [list, q]);

  const enabledCount = list.length - disabledSkills.filter((id) => list.some((a) => a.id === id)).length;

  if (preview) {
    return <SkillPreview artifact={preview} onBack={() => setPreview(null)} />;
  }

  return (
    <div>
      <SectionHeader
        title="Skills"
        description="Built-in skills extend what agents can do. Disabled skills are excluded from the chat slash menu and skill pickers, so they are never offered to you or sent to models."
      />

      <SectionListHeader
        title={skills ? `${enabledCount} of ${list.length} enabled` : 'Built-in skills'}
        action={<div className="w-[13rem]"><SearchInput value={q} onChange={setQ} placeholder="Search skills…" /></div>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading skills…</div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No skills found.</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map((a) => (
            <SkillRow
              key={a.id}
              artifact={a}
              enabled={!disabledSkills.includes(a.id)}
              onToggle={(on) => setSkillEnabled(a.id, on)}
              expanded={expanded === a.id}
              onExpand={() => setExpanded((cur) => (cur === a.id ? null : a.id))}
              onPreview={() => setPreview(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SkillRow({
  artifact, enabled, onToggle, expanded, onExpand, onPreview,
}: {
  artifact: ArtifactWithSource;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  expanded: boolean;
  onExpand: () => void;
  onPreview: () => void;
}) {
  return (
    <CatalogAccordionRow
      icon={<FileText className="h-4 w-4 text-primary" />}
      title={artifact.name}
      badge={<Badge tone="neutral" size="sm" className="shrink-0 capitalize">{artifact.source}</Badge>}
      subtitle={artifact.description}
      disabled={!enabled}
      expanded={expanded}
      onToggleExpanded={onExpand}
      control={
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={`${enabled ? 'Disable' : 'Enable'} skill ${artifact.name}`}
        />
      }
    >
      {/* Description block at the top of the expanded row. */}
      <div className="rounded-md border border-border bg-card px-3 py-2.5">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Description</div>
        <p className="text-xs leading-relaxed text-foreground break-words">
          {artifact.description || 'No description provided for this skill.'}
        </p>
      </div>
      <div className="mt-2.5 flex items-center justify-end">
        <Button variant="secondary" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={onPreview}>
          Preview full details
        </Button>
      </div>
    </CatalogAccordionRow>
  );
}

function SkillPreview({ artifact, onBack }: { artifact: ArtifactWithSource; onBack: () => void }) {
  const { data: content, isLoading } = useArtifactContent(undefined, artifact.id, 'system');
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to skills
      </button>

      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-primary">
          <FileText className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{artifact.name}</h2>
            <Badge tone="neutral" size="sm" className="capitalize">{artifact.source}</Badge>
          </div>
          {artifact.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{artifact.description}</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Full details</div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading details…</div>
        ) : content ? (
          <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-subtle px-3 py-2.5 text-[11px] leading-relaxed text-foreground">
            {content}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">No additional details.</p>
        )}
      </div>
    </div>
  );
}

// ── MCP servers ──

export function McpSection() {
  const [view, setView] = useState<'list' | 'add'>('list');
  const { data: servers, isLoading } = useSystemMcpServers();
  const disabledMcp = useCatalogPrefsStore((s) => s.disabledMcp);
  const setMcpEnabled = useCatalogPrefsStore((s) => s.setMcpEnabled);
  const customServers = useCustomMcpStore((s) => s.servers);
  const removeCustom = useCustomMcpStore((s) => s.removeServer);
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = (servers as McpServerEntry[] | undefined) ?? [];
  const total = list.length + customServers.length;
  const enabledCount = total - disabledMcp.filter((id) => list.some((s) => s.id === id) || customServers.some((s) => s.id === id)).length;

  if (view === 'add') {
    return <McpAddForm onDone={() => setView('list')} />;
  }

  return (
    <div>
      <SectionHeader
        title="MCP Servers"
        description="Model Context Protocol servers extend agents with external tools. Disabled servers are hidden from the per-stage MCP selector when building workflows."
      />

      <SectionListHeader
        title={total > 0 ? `${enabledCount} of ${total} enabled` : 'MCP servers'}
        action={
          <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setView('add')}>
            Add server
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading servers…</div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <Server className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No MCP servers yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Add a server to extend the agent with external tools, or configure them per project.
          </p>
          <Button variant="secondary" size="sm" className="mt-1" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setView('add')}>
            Add server
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {list.map((s) => (
            <McpRow
              key={s.id}
              server={s}
              enabled={!disabledMcp.includes(s.id)}
              onToggle={(on) => setMcpEnabled(s.id, on)}
              expanded={expanded === s.id}
              onExpand={() => setExpanded((cur) => (cur === s.id ? null : s.id))}
            />
          ))}
          {customServers.map((s) => (
            <CustomMcpRow
              key={s.id}
              server={s}
              enabled={!disabledMcp.includes(s.id)}
              onToggle={(on) => setMcpEnabled(s.id, on)}
              onRemove={() => { removeCustom(s.id); if (expanded === s.id) setExpanded(null); }}
              expanded={expanded === s.id}
              onExpand={() => setExpanded((cur) => (cur === s.id ? null : s.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function McpRow({
  server, enabled, onToggle, expanded, onExpand,
}: {
  server: McpServerEntry;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const isHttp = server.serverType === 'http';
  const Icon = isHttp ? Globe : Terminal;
  return (
    <CatalogAccordionRow
      icon={<Icon className={cn('h-4 w-4', isHttp ? 'text-info' : 'text-primary')} />}
      title={server.name}
      badge={<Badge tone="neutral" size="sm" className="shrink-0 uppercase">{server.serverType}</Badge>}
      subtitle={server.url ?? server.command ?? server.serverType}
      disabled={!enabled}
      expanded={expanded}
      onToggleExpanded={onExpand}
      control={
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={`${enabled ? 'Disable' : 'Enable'} MCP server ${server.name}`}
        />
      }
    >
      <div className="space-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-xs">
        {server.description && <p className="text-muted-foreground break-words">{server.description}</p>}
        <DetailLine label="Type" value={server.serverType} />
        {server.url && <DetailLine label="URL" value={server.url} mono />}
        {server.command && <DetailLine label="Command" value={server.command} mono />}
        {server.args && server.args.length > 0 && <DetailLine label="Args" value={server.args.join(' ')} mono />}
        <DetailLine label="Source" value={server.source} />
      </div>
    </CatalogAccordionRow>
  );
}

function CustomMcpRow({
  server, enabled, onToggle, onRemove, expanded, onExpand,
}: {
  server: CustomMcpServer;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onRemove: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const isLocal = server.transport === 'local';
  const Icon = isLocal ? Terminal : Globe;
  const envEntries = Object.entries(server.env ?? {});
  return (
    <CatalogAccordionRow
      icon={<Icon className={cn('h-4 w-4', isLocal ? 'text-primary' : 'text-info')} />}
      title={server.name}
      badge={
        <span className="flex items-center gap-1.5">
          <Badge tone="neutral" size="sm" className="shrink-0 uppercase">{server.transport}</Badge>
          <Badge tone="info" size="sm" className="shrink-0">Custom</Badge>
        </span>
      }
      subtitle={server.url ?? server.command ?? server.transport}
      disabled={!enabled}
      expanded={expanded}
      onToggleExpanded={onExpand}
      control={
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          aria-label={`${enabled ? 'Disable' : 'Enable'} MCP server ${server.name}`}
        />
      }
    >
      <div className="space-y-1.5 rounded-md border border-border bg-card px-3 py-2.5 text-xs">
        <DetailLine label="Transport" value={server.transport} />
        {server.command && <DetailLine label="Command" value={server.command} mono />}
        {server.args && <DetailLine label="Args" value={server.args} mono />}
        {server.url && <DetailLine label="URL" value={server.url} mono />}
        {envEntries.length > 0 && <DetailLine label="Env" value={envEntries.map(([k]) => k).join(', ')} mono />}
        <DetailLine label="Timeout" value={`${server.timeoutSec ?? 180}s`} />
        <div className="pt-1">
          <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5 text-danger" />} onClick={onRemove}>
            <span className="text-danger">Remove</span>
          </Button>
        </div>
      </div>
    </CatalogAccordionRow>
  );
}

// ── MCP add-server sub-page ──

const TRANSPORTS: Array<{ id: CustomMcpTransport; label: string }> = [
  { id: 'local', label: 'Local' },
  { id: 'http', label: 'HTTP' },
  { id: 'sse', label: 'SSE' },
];

function McpAddForm({ onDone }: { onDone: () => void }) {
  const addServer = useCustomMcpStore((s) => s.addServer);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<CustomMcpTransport>('local');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [timeoutSec, setTimeoutSec] = useState('');

  const isLocal = transport === 'local';
  const canSave = name.trim().length > 0 && (isLocal ? command.trim().length > 0 : url.trim().length > 0);

  const handleSave = () => {
    if (!canSave) return;
    const env = envVars.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});
    addServer({
      name: name.trim(),
      transport,
      command: isLocal ? command.trim() : undefined,
      args: isLocal && args.trim() ? args.trim() : undefined,
      url: !isLocal ? url.trim() : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      timeoutSec: timeoutSec.trim() ? Number(timeoutSec) : undefined,
    });
    onDone();
  };

  return (
    <div>
      <button
        type="button"
        onClick={onDone}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to MCP servers
      </button>

      <SectionHeader title="Add server" description="Configure a Model Context Protocol server to extend agents with external tools." />

      {/* Elevated form card with its own background + shadow. */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-md">
        <div className="space-y-4">
          <Field label="Server name">
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" className="flex-1" />
              <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-subtle p-0.5">
                {TRANSPORTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTransport(t.id)}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                      transport === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </Field>

          {isLocal ? (
            <>
              <Field label="Command">
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="font-mono text-xs" />
              </Field>
              <Field label="Arguments">
                <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" className="font-mono text-xs" />
              </Field>
            </>
          ) : (
            <Field label="Server URL">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" className="font-mono text-xs" />
            </Field>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground">Environment variables</label>
            <div className="space-y-2">
              {envVars.map((pair, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={pair.key}
                    onChange={(e) => setEnvVars((cur) => cur.map((p, idx) => (idx === i ? { ...p, key: e.target.value } : p)))}
                    placeholder="KEY"
                    className="flex-1 font-mono text-xs"
                  />
                  <Input
                    value={pair.value}
                    onChange={(e) => setEnvVars((cur) => cur.map((p, idx) => (idx === i ? { ...p, value: e.target.value } : p)))}
                    placeholder="value"
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEnvVars((cur) => cur.filter((_, idx) => idx !== i))}
                    aria-label="Remove variable"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setEnvVars((cur) => [...cur, { key: '', value: '' }])}
              >
                Add variable
              </Button>
            </div>
          </div>

          <Field label="Timeout (seconds)">
            <Input
              type="number"
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(e.target.value)}
              placeholder="180"
              className="max-w-[10rem]"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Default: 180 seconds (3 minutes)</p>
          </Field>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" size="sm" onClick={onDone}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave}>Add server</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words text-foreground', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

// ── Templates ──

export function TemplatesSection() {
  // `isError` is read deliberately. This component used to destructure only
  // `{ data, isLoading }`, so a FAILED fetch fell through to the empty state
  // and told the user "No templates found" — indistinguishable from a catalog
  // that is genuinely empty, and with no way to recover. `useTemplates` sets
  // `staleTime: Infinity` and nothing invalidates it, so within a mounted
  // settings modal that wrong answer was also a permanent one.
  const { data: templates, isLoading, isError, refetch, isFetching } = useTemplates();
  const createFromTemplate = useCreateFromTemplate();
  const navigate = useNavigate();
  const closeSettings = useSettingsUiStore((s) => s.closeSettings);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const listAll = templates ?? [];
    if (!q.trim()) return listAll;
    const s = q.toLowerCase();
    return listAll.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s));
  }, [templates, q]);

  return (
    <div>
      <SectionHeader title="Templates" description="Start a new workflow from a ready-made template." />

      <SectionListHeader
        title={templates ? `${templates.length} templates` : 'Workflow templates'}
        action={<div className="w-[13rem]"><SearchInput value={q} onChange={setQ} placeholder="Search templates…" /></div>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading templates…</div>
      ) : isError ? (
        <div
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--color-danger)] py-10 text-center"
          data-testid="templates-error"
        >
          <AlertTriangle className="h-8 w-8 text-[var(--color-danger)]" />
          <p className="text-sm text-foreground">Couldn&apos;t load templates.</p>
          <p className="text-xs text-muted-foreground">
            The catalog request failed — this is not an empty catalog.
          </p>
          <Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <LayoutTemplate className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No templates found.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-primary">
                <LayoutTemplate className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{t.name}</span>
                  <Badge tone="primary" size="sm" className="shrink-0">{t.category}</Badge>
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                loading={createFromTemplate.isPending}
                rightIcon={!createFromTemplate.isPending ? <ChevronRight className="h-3.5 w-3.5" /> : undefined}
                onClick={async () => {
                  const def = await createFromTemplate.mutateAsync({ templateId: t.id });
                  closeSettings();
                  navigate(`/workflows/${def.id}`);
                }}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
