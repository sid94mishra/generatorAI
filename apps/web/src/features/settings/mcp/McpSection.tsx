// ────────────────────────────────────────────────────────────────
// F-settings-07 MCP servers (04 §3.1). Model Context Protocol servers
// extend agents with external tools. Disabled servers are hidden from the
// per-stage MCP selector when building workflows. Supports adding
// user-defined servers via an in-modal "Add server" sub-page.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import type { McpServerEntry } from '@generatorai/shared';
import {
  useCreateCustomMcpServer,
  useDeleteCustomMcpServer,
  useSystemMcpServers,
  useUpdateCustomMcpServer,
  useUpdateSystemMcpServerPrefs,
} from '@/hooks/projectQueries.js';
import { readLegacyCustomMcpServers, clearLegacyCustomMcpServers } from '@/stores/customMcpStore.js';
import { useCatalogPrefsStore } from '@/stores/catalogPrefsStore.js';
import { cn } from '@/ui/lib/cn.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { SegmentedControl, type SegmentedItem } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { CatalogRow } from '../CatalogRow.js';

/**
 * W48 — one-time migration off the browser-only `customMcpStore`. A pre-W48
 * build wrote custom servers ONLY to localStorage, so the server-side
 * harness config builder never saw them; this POSTs each one to the
 * server-side endpoint, then deletes the legacy key so it never runs twice.
 * Returns how many were moved, for an inline notice (D-30: no toasts here —
 * `features/` cannot reach the toast module anyway, D-04).
 */
function useMigrateLegacyCustomMcpServers(): number {
  const createCustom = useCreateCustomMcpServer();
  const ranRef = useRef(false);
  const [migrated, setMigrated] = useState(0);
  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const legacy = readLegacyCustomMcpServers();
    if (legacy.length === 0) return;
    void (async () => {
      let count = 0;
      for (const s of legacy) {
        try {
          await createCustom.mutateAsync({
            name: s.name,
            serverType: s.transport === 'local' ? 'stdio' : s.transport,
            command: s.transport === 'local' ? s.command : undefined,
            args: s.transport === 'local' && s.args ? s.args.split(/\s+/).filter(Boolean) : undefined,
            url: s.transport !== 'local' ? s.url : undefined,
            env: s.transport === 'local' ? s.env : undefined,
            headers: s.transport !== 'local' ? s.env : undefined,
            timeoutMs: s.timeoutSec ? s.timeoutSec * 1000 : undefined,
          });
          count += 1;
        } catch {
          // Left in localStorage — retried on the next mount.
        }
      }
      clearLegacyCustomMcpServers();
      setMigrated(count);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return migrated;
}

export function McpSection() {
  const [view, setView] = useState<'list' | 'add'>('list');
  const { data: servers, isLoading } = useSystemMcpServers();
  const disabledMcp = useCatalogPrefsStore((s) => s.disabledMcp);
  const setMcpEnabled = useCatalogPrefsStore((s) => s.setMcpEnabled);
  const deleteCustom = useDeleteCustomMcpServer();
  const updateCustom = useUpdateCustomMcpServer();
  const [expanded, setExpanded] = useState<string | null>(null);

  // A custom server's toggle persists server-side; a bundled/project
  // server's toggle stays the pre-existing client-only picker filter
  // (`catalogPrefsStore`). `headers`/`env` are resent as their REDACTED form
  // from the GET response, which the credential vault treats as "keep the
  // stored value" — a toggle must never wipe a saved credential.
  const toggleCustom = (s: McpServerEntry, on: boolean): void => {
    void updateCustom.mutateAsync({
      id: s.id,
      data: {
        name: s.name,
        description: s.description,
        serverType: s.serverType,
        url: s.url,
        command: s.command,
        args: s.args,
        timeoutMs: s.timeoutMs,
        enabled: on,
        headers: s.headers,
        env: s.env,
      },
    });
    setMcpEnabled(s.id, on);
  };

  const migrated = useMigrateLegacyCustomMcpServers();

  const list = (servers as McpServerEntry[] | undefined) ?? [];
  const total = list.length;
  const enabledCount = total - disabledMcp.filter((id) => list.some((s) => s.id === id)).length;

  if (view === 'add') return <McpAddForm onDone={() => setView('list')} />;

  return (
    <SettingsSection
      title="MCP Servers"
      description="Model Context Protocol servers extend agents with external tools. Disabled servers are hidden from the per-stage MCP selector when building workflows."
    >
      <SectionHeader
        title={total > 0 ? `${enabledCount} of ${total} enabled` : 'MCP servers'}
        level={3}
        action={
          <Button variant="primary" size="sm" icon="plus" className="ml-auto" onClick={() => setView('add')}>
            Add server
          </Button>
        }
      />

      {migrated > 0 ? (
        <Callout tone="ok">
          Moved {migrated} MCP server{migrated === 1 ? '' : 's'} to your account — custom servers now live on the server instead of only this browser, so they actually reach chats.
        </Callout>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading servers…
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon="server"
          title="No MCP servers yet"
          description="Add a server to extend the agent with external tools, or configure them per project."
          action={
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setView('add')}>
              Add server
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((s) => (
            <McpRow
              key={s.id}
              server={s}
              enabled={!disabledMcp.includes(s.id)}
              onToggle={(on) => (s.source === 'custom' ? toggleCustom(s, on) : setMcpEnabled(s.id, on))}
              onRemove={s.source === 'custom' ? () => { void deleteCustom.mutateAsync(s.id); if (expanded === s.id) setExpanded(null); } : undefined}
              open={expanded === s.id}
              onOpenChange={(open) => setExpanded(open ? s.id : null)}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function McpRow({
  server,
  enabled,
  onToggle,
  onRemove,
  open,
  onOpenChange,
}: {
  server: McpServerEntry;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onRemove?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isHttp = server.serverType === 'http' || server.serverType === 'sse';
  const needsSetup = Boolean(
    server.needsConfiguration &&
      (server.needsConfiguration.missingInputs.length > 0 || server.needsConfiguration.missingCredentials.length > 0),
  );
  return (
    <CatalogRow
      icon={isHttp ? 'browser' : 'terminal'}
      title={server.name}
      badges={
        <>
          <Badge tone="neutral" className="uppercase">{server.serverType}</Badge>
          {server.source === 'custom' ? <Badge tone="neutral">Custom</Badge> : null}
          {needsSetup ? <Badge tone="warn" icon="warning">Needs setup</Badge> : null}
        </>
      }
      subtitle={server.url ?? server.command ?? server.serverType}
      disabled={!enabled}
      open={open}
      onOpenChange={onOpenChange}
      control={
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`${enabled ? 'Disable' : 'Enable'} MCP server ${server.name}`} />
      }
    >
      <div className="rounded-control-sm border border-line bg-raised px-3 py-2.5 text-small">
        {server.description ? <p className="mb-1.5 text-fg-2">{server.description}</p> : null}
        <dl className="flex flex-col gap-1">
          <DetailLine label="Type" value={server.serverType} />
          {server.url ? <DetailLine label="URL" value={server.url} mono /> : null}
          {server.command ? <DetailLine label="Command" value={server.command} mono /> : null}
          {server.args && server.args.length > 0 ? <DetailLine label="Args" value={server.args.join(' ')} mono /> : null}
          {server.headers && Object.keys(server.headers).length > 0 ? (
            <DetailLine label="Headers" value={Object.keys(server.headers).join(', ')} mono />
          ) : null}
          {server.env && Object.keys(server.env).length > 0 ? <DetailLine label="Env" value={Object.keys(server.env).join(', ')} mono /> : null}
          <DetailLine label="Source" value={server.source} />
        </dl>
      </div>

      {needsSetup || (server.inputs && server.inputs.length > 0) || server.credentials ? <McpConfigureForm server={server} /> : null}

      {onRemove ? (
        <div className="pt-1.5">
          <Button variant="danger-ghost" size="sm" icon="trash" onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : null}
    </CatalogRow>
  );
}

/**
 * Inline setup form for a bundled server's `{{input}}` values and required
 * credentials — shown for system servers with declared inputs/credentials;
 * a custom server has neither. Values save via the prefs endpoint, which
 * merges field-by-field so an untouched credential is left alone.
 */
function McpConfigureForm({ server }: { server: McpServerEntry }) {
  const updatePrefs = useUpdateSystemMcpServerPrefs();
  const [inputs, setInputs] = useState<Record<string, string>>(server.inputValues ?? {});
  const [env, setEnv] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const envCreds = server.credentials?.env ?? [];
  const headerCreds = server.credentials?.headers ?? [];
  if (server.source === 'custom' || (!server.inputs?.length && envCreds.length === 0 && headerCreds.length === 0)) return null;

  const handleSave = async () => {
    await updatePrefs.mutateAsync({
      id: server.id,
      data: {
        enabled: true,
        ...(server.inputs?.length ? { inputs } : {}),
        ...(envCreds.length ? { env } : {}),
        ...(headerCreds.length ? { headers } : {}),
      },
    });
    setSaved(true);
  };

  const filledCount =
    (server.inputs ?? []).filter((i) => (inputs[i.key] ?? '').trim().length > 0).length +
    envCreds.filter((c) => (env[c.name] ?? '').trim().length > 0).length +
    headerCreds.filter((c) => (headers[c.name] ?? '').trim().length > 0).length;
  const requiredCount =
    (server.inputs ?? []).filter((i) => i.required !== false).length +
    envCreds.filter((c) => c.required !== false).length +
    headerCreds.filter((c) => c.required !== false).length;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-control-sm border border-dashed border-line bg-sunken px-3 py-2.5">
      <SectionHeader variant="label" title="Setup required" />
      {(server.inputs ?? []).map((i) => (
        <Field key={i.key} label={i.label} hint={i.description}>
          <Input
            mono
            size="sm"
            value={inputs[i.key] ?? ''}
            onChange={(e) => { setSaved(false); setInputs((cur) => ({ ...cur, [i.key]: e.target.value })); }}
            placeholder={i.placeholder}
          />
        </Field>
      ))}
      {envCreds.map((c) => (
        <Field key={c.name} label={c.label}>
          <Input
            mono
            size="sm"
            type="password"
            value={env[c.name] ?? ''}
            onChange={(e) => { setSaved(false); setEnv((cur) => ({ ...cur, [c.name]: e.target.value })); }}
            placeholder={c.description ?? c.name}
          />
        </Field>
      ))}
      {headerCreds.map((c) => (
        <Field key={c.name} label={c.label}>
          <Input
            mono
            size="sm"
            type="password"
            value={headers[c.name] ?? ''}
            onChange={(e) => { setSaved(false); setHeaders((cur) => ({ ...cur, [c.name]: e.target.value })); }}
            placeholder={c.description ?? c.name}
          />
        </Field>
      ))}
      <div className="flex items-center justify-between pt-1">
        <span className="text-micro text-fg-3">
          {saved ? 'Saved · ' : ''}
          {filledCount} of {requiredCount} required fields filled
        </span>
        <Button variant="primary" size="sm" loading={updatePrefs.isPending} onClick={() => void handleSave()}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Add-server sub-page ──

type AddServerTransport = 'stdio' | 'http' | 'sse';

const TRANSPORTS: readonly SegmentedItem<AddServerTransport>[] = [
  { value: 'stdio', label: 'Local' },
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
];

function McpAddForm({ onDone }: { onDone: () => void }) {
  const createCustom = useCreateCustomMcpServer();
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<AddServerTransport>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [timeoutSec, setTimeoutSec] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isLocal = transport === 'stdio';
  const canSave = name.trim().length > 0 && (isLocal ? command.trim().length > 0 : url.trim().length > 0);

  const handleSave = async () => {
    if (!canSave) return;
    setSaveError(null);
    const env = envVars.reduce<Record<string, string>>((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {});
    try {
      await createCustom.mutateAsync({
        name: name.trim(),
        serverType: transport,
        command: isLocal ? command.trim() : undefined,
        args: isLocal && args.trim() ? args.trim().split(/\s+/) : undefined,
        url: !isLocal ? url.trim() : undefined,
        env: isLocal && Object.keys(env).length > 0 ? env : undefined,
        headers: !isLocal && Object.keys(env).length > 0 ? env : undefined,
        timeoutMs: timeoutSec != null ? timeoutSec * 1000 : undefined,
      });
      onDone();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save server.');
    }
  };

  return (
    <SettingsSection title="Add server" description="Configure a Model Context Protocol server to extend agents with external tools.">
      <Button variant="ghost" size="sm" icon="back" className="self-start" onClick={onDone}>
        Back to MCP servers
      </Button>

      <div className="flex flex-col gap-4 rounded-card border border-line bg-raised p-5">
        <Field label="Server name">
          <div className="flex items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" className="flex-1" />
            <SegmentedControl label="Transport" value={transport} onValueChange={setTransport} items={TRANSPORTS} />
          </div>
        </Field>

        {isLocal ? (
          <>
            <Field label="Command">
              <Input mono value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </Field>
            <Field label="Arguments">
              <Input mono value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
            </Field>
          </>
        ) : (
          <Field label="Server URL">
            <Input mono value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </Field>
        )}

        <div className="flex flex-col gap-2">
          <SectionHeader
            level={4}
            title={isLocal ? 'Environment variables' : 'Headers'}
            hint="Values are written to the secrets vault and never appear again in this form or in any GET response."
          />
          {envVars.map((pair, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                mono
                size="sm"
                value={pair.key}
                onChange={(e) => setEnvVars((cur) => cur.map((p, idx) => (idx === i ? { ...p, key: e.target.value } : p)))}
                placeholder="KEY"
                className="flex-1"
              />
              <Input
                mono
                size="sm"
                value={pair.value}
                onChange={(e) => setEnvVars((cur) => cur.map((p, idx) => (idx === i ? { ...p, value: e.target.value } : p)))}
                placeholder="value"
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                icon="x"
                aria-label="Remove variable"
                onClick={() => setEnvVars((cur) => cur.filter((_, idx) => idx !== i))}
              />
            </div>
          ))}
          <Button variant="ghost" size="sm" icon="plus" className="self-start" onClick={() => setEnvVars((cur) => [...cur, { key: '', value: '' }])}>
            Add variable
          </Button>
        </div>

        <Field label="Timeout" hint="Default: 180 seconds (3 minutes).">
          <NumberField value={timeoutSec ?? undefined} onValueChange={setTimeoutSec} unit="s" min={1} className="max-w-32" aria-label="Timeout in seconds" />
        </Field>

        {saveError ? <Callout tone="err">{saveError}</Callout> : null}

        <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
          <Button variant="secondary" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={createCustom.isPending} disabled={!canSave} onClick={() => void handleSave()}>
            Add server
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-fg-3">{label}</dt>
      <dd className={cn('min-w-0 break-words text-fg', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
