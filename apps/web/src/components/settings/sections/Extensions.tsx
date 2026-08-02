// ────────────────────────────────────────────────────────────────
// Settings → Extensions section.
// Install (by path), enable/disable, reload, and uninstall hot-loadable
// extensions. All operations take effect immediately (server hot-reload).
// ────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { Blocks, RefreshCw, Trash2, Package } from 'lucide-react';
import { Button, Input, Select, Badge, Switch, Spinner, ConfirmDialog } from '@/components/ui/index.js';
import { SectionHeader, SettingsCard, SectionListHeader } from '../shared.js';

interface InstalledExtensionDTO {
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    contributes?: {
      widgets?: unknown[];
      tools?: unknown[];
      mcpServers?: unknown[];
      skills?: unknown[];
      agents?: unknown[];
      prompts?: unknown[];
      hooks?: unknown[];
    };
  };
  scope: 'system' | 'user' | 'workspace';
  rootPath: string;
  enabled: boolean;
  ready: boolean;
  errors?: string[];
}

export function ExtensionsSection() {
  const [items, setItems] = useState<InstalledExtensionDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installPath, setInstallPath] = useState('');
  const [scope, setScope] = useState<'user' | 'workspace'>('user');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch('/api/extensions');
      if (!r.ok) throw new Error(`GET /api/extensions → ${r.status}`);
      const body = (await r.json()) as { extensions: InstalledExtensionDTO[] };
      setItems(body.extensions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void refresh(); }, []);

  const reloadAll = async () => {
    setBusy(true);
    try { await fetch('/api/extensions/reload', { method: 'POST' }); await refresh(); }
    finally { setBusy(false); }
  };

  const install = async () => {
    if (!installPath.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/extensions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: installPath.trim(), scope }),
      });
      if (!r.ok) throw new Error(`install → ${r.status} ${await r.text()}`);
      setInstallPath('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const uninstall = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/extensions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`uninstall → ${r.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); setConfirmId(null); }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    // Optimistic, per-item update — no global busy so other rows stay
    // interactive and the list doesn't flash/re-render wholesale.
    setItems((cur) => cur?.map((e) => (e.manifest.id === id ? { ...e, enabled } : e)) ?? cur);
    setError(null);
    try {
      const r = await fetch(`/api/extensions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error(`toggle → ${r.status}`);
      const body = (await r.json()) as { extension?: InstalledExtensionDTO };
      if (body.extension) {
        setItems((cur) => cur?.map((e) => (e.manifest.id === id ? body.extension! : e)) ?? cur);
      }
    } catch (e) {
      // Revert on failure.
      setItems((cur) => cur?.map((e) => (e.manifest.id === id ? { ...e, enabled: !enabled } : e)) ?? cur);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <SectionHeader
        title="Extensions"
        description="Hot-loadable extensions contribute widgets, tools, skills, prompts, and hooks."
      />

      <div className="space-y-4">
        <SettingsCard title="Install an extension" description="Absolute path to a folder containing an extension.json. It's copied into the target scope and hot-loaded.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="C:\path\to\extension"
              className="flex-1"
            />
            <div className="w-40">
              <Select
                value={scope}
                onChange={(v) => setScope(v as 'user' | 'workspace')}
                options={[
                  { value: 'user', label: 'User scope' },
                  { value: 'workspace', label: 'Workspace scope' },
                ]}
                aria-label="Install scope"
              />
            </div>
            <Button variant="primary" onClick={install} disabled={busy || !installPath.trim()}>Install</Button>
            <Button variant="secondary" onClick={reloadAll} disabled={busy} leftIcon={<RefreshCw className={busy ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />}>
              Reload all
            </Button>
          </div>
          {error && (
            <div className="mt-2 rounded border border-danger/30 bg-danger-muted px-2 py-1 text-xs text-danger">{error}</div>
          )}
        </SettingsCard>

        <div>
          <SectionListHeader title={`Installed${items ? ` (${items.length})` : ''}`} />
          {items === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading…</div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
              <Package className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No extensions installed.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((ext) => {
                const c = ext.manifest.contributes ?? {};
                const chips: Array<[string, number]> = [
                  ['widgets', c.widgets?.length ?? 0],
                  ['tools', c.tools?.length ?? 0],
                  ['skills', c.skills?.length ?? 0],
                  ['prompts', c.prompts?.length ?? 0],
                  ['hooks', c.hooks?.length ?? 0],
                  ['mcp', c.mcpServers?.length ?? 0],
                ];
                const isSystem = ext.scope === 'system';
                return (
                  <div key={ext.manifest.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-primary">
                          <Blocks className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{ext.manifest.name}</span>
                            <code className="break-all text-[10px] text-muted-foreground">{ext.manifest.id}@{ext.manifest.version}</code>
                            <Badge tone={isSystem ? 'info' : 'neutral'} size="sm" className="capitalize">{ext.scope}</Badge>
                            {ext.enabled && !ext.ready && <Badge tone="danger" size="sm">Error</Badge>}
                            {!ext.enabled && <Badge tone="neutral" size="sm">Disabled</Badge>}
                          </div>
                          {ext.manifest.description && (
                            <p className="mt-0.5 break-words text-xs text-muted-foreground">{ext.manifest.description}</p>
                          )}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {chips.filter(([, n]) => n > 0).map(([k, n]) => (
                              <Badge key={k} tone="neutral" size="sm">{n} {k}</Badge>
                            ))}
                          </div>
                          {ext.rootPath && (
                            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{ext.rootPath}</p>
                          )}
                          {ext.errors && ext.errors.length > 0 && (
                            <p className="mt-1 break-words text-[10px] text-danger">{ext.errors.join('; ')}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Switch
                          checked={ext.enabled}
                          onCheckedChange={(next) => setEnabled(ext.manifest.id, next)}
                          disabled={busy || isSystem}
                          aria-label={`${ext.enabled ? 'Disable' : 'Enable'} extension ${ext.manifest.name}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy || isSystem}
                          onClick={() => setConfirmId(ext.manifest.id)}
                          aria-label="Uninstall extension"
                          className={isSystem ? 'invisible' : undefined}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title="Uninstall extension"
        description={`Remove ${confirmId ?? ''}? This deletes the extension folder from its scope.`}
        confirmLabel="Uninstall"
        variant="destructive"
        loading={busy}
        onConfirm={() => confirmId && uninstall(confirmId)}
      />
    </div>
  );
}
