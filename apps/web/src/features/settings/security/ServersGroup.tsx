// Security › Servers: which servers this app talks to (G-03's list), with
// Switch, Forget (a web tab's paired servers) and Add server (desktop).

import { addServer, canAddServer, canForgetServer, switchServer, useForgetServer, useServers, type ServerListItem } from '@/hooks/serverQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Icon } from '@/ui/icons/Icon.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsTable, type SettingsTableColumn } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const STATUS: Record<ServerListItem['status'], { label: string; tone: 'ok' | 'err' | 'warn' | 'neutral' } | null> = {
  connected: { label: 'Reachable', tone: 'neutral' },
  unpaired: { label: 'Needs pairing', tone: 'warn' },
  error: { label: 'Error', tone: 'err' },
  offline: { label: 'Offline', tone: 'err' },
  unknown: null,
};

export function ServersGroup() {
  const servers = useServers();
  const forget = useForgetServer();
  const confirmer = useConfirm();
  const rows = servers.data ?? [];

  const columns: SettingsTableColumn<ServerListItem>[] = [
    {
      id: 'server',
      header: 'Server',
      width: '1fr',
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-2">
          <Icon concept={s.kind === 'remote' ? 'server' : 'computer'} size={14} className="shrink-0 text-fg-3" />
          <span className="truncate text-fg">{s.label}</span>
          <span className="truncate font-mono text-small text-fg-3">{s.url.replace(/^https?:\/\//, '')}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 120,
      cell: (s) => {
        if (s.active) return <Badge tone="ok" icon="status-succeeded">Connected</Badge>;
        const status = STATUS[s.status];
        return status ? <Badge tone={status.tone}>{status.label}</Badge> : null;
      },
    },
  ];

  const onForget = async (s: ServerListItem) => {
    const ok = await confirmer.confirm({
      title: `Forget ${s.label}?`,
      description: "This device's credential for it is deleted, and you will need a new pairing code to connect again.",
      confirmLabel: 'Forget',
      tone: 'danger',
    });
    if (ok) forget(s.id);
  };

  return (
    <section className="flex flex-col gap-2" data-testid="security-servers">
      <SectionHeader
        title="Servers"
        level={3}
        hint="Each keeps its own credential"
        action={
          canAddServer() ? (
            <Button variant="ghost" size="sm" icon="plus" onClick={addServer}>
              Add server
            </Button>
          ) : null
        }
      />
      {servers.error ? (
        <p className="text-small text-err">Could not list servers: {servers.error.message}</p>
      ) : (
        <SettingsTable
          label="Servers"
          columns={columns}
          rows={rows}
          getRowId={(s) => s.id}
          actionsWidth={96}
          empty={<p className="text-small text-fg-3">{servers.isPending ? 'Loading…' : 'No servers.'}</p>}
          rowActions={(s) => (
            <span className="flex items-center justify-end gap-1">
              {!s.active ? (
                <Button size="sm" onClick={() => switchServer(s.id)}>
                  Switch
                </Button>
              ) : null}
              {canForgetServer(s) ? (
                <IconButton size="sm" icon="trash" label={`Forget ${s.label}`} onClick={() => void onForget(s)} />
              ) : null}
            </span>
          )}
        />
      )}
      {confirmer.dialog}
    </section>
  );
}
