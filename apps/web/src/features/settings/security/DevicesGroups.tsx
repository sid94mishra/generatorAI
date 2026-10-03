// Security › Pending access requests and Paired devices.
//
// A request is a paired device asking for more scopes than it holds: untick
// what you do not want to grant and approve the rest. A device's
// capabilities can be granted or withdrawn after pairing (the Capabilities
// menu); a sensitive grant (shared vocabulary, MG-23: every `exec:*` but
// `exec:agent`, every `admin:*`) is confirmed first.

import { useState } from 'react';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';
import {
  useApproveScopeRequest,
  useDenyScopeRequest,
  useRevokeDevice,
  useSetDeviceScopes,
  type DeviceSummary,
  type ScopeRequestSummary,
} from '@/hooks/securityQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Menu } from '@/ui/primitives/Menu/Menu.js';
import { Tooltip } from '@/ui/primitives/Tooltip/Tooltip.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { Icon } from '@/ui/icons/Icon.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsTable, type SettingsTableColumn } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import {
  GRANTABLE_CAPABILITIES,
  PLATFORM_ICON,
  PLATFORM_LABEL,
  accessLevel,
  ago,
  relativeTime,
  sensitiveGrantText,
} from './securityModel.js';

type OnError = (err: unknown) => void;

function RequestRow({ request, onError }: { request: ScopeRequestSummary; onError: OnError }) {
  const [selected, setSelected] = useState<string[]>(() => [...request.scopes]);
  const approve = useApproveScopeRequest();
  const deny = useDenyScopeRequest();
  const confirmer = useConfirm();
  const busy = approve.isPending || deny.isPending;
  const name = request.deviceName ?? 'Unnamed device';

  const onApprove = async () => {
    const scopes = selected.filter((s) => request.scopes.includes(s));
    if (scopes.length === 0) return;
    const what = sensitiveGrantText(scopes);
    if (what) {
      const ok = await confirmer.confirm({
        title: `Allow "${name}" to ${what}?`,
        description: 'This takes effect the next time that device refreshes its session.',
        confirmLabel: 'Allow',
      });
      if (!ok) return;
    }
    approve.mutate(
      { requestId: request.requestId, ...(scopes.length === request.scopes.length ? {} : { scopes }) },
      { onError },
    );
  };

  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0" data-testid="security-request">
      <Icon concept={PLATFORM_ICON[request.platform ?? 'other'] ?? 'key'} size={16} className="mt-0.5 shrink-0 text-fg-3" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui font-medium text-fg">{name}</span>
          <span className="shrink-0 text-small text-fg-3">asked {ago(request.createdAt)}</span>
        </div>
        {request.reason ? <p className="text-small text-fg-2">“{request.reason}”</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {request.scopes.map((scope) => (
            <Checkbox
              key={scope}
              size="sm"
              disabled={busy}
              checked={selected.includes(scope)}
              onCheckedChange={(on) => setSelected((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)))}
              label={
                <span className="inline-flex items-center gap-1">
                  {scopeLabel(scope)}
                  {isSensitiveScope(scope) ? (
                    <Icon concept="warning" size={12} className="text-warn" />
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => deny.mutate(request.requestId, { onError })}>
          Deny
        </Button>
        <Button size="sm" icon="check" disabled={busy || selected.length === 0} loading={approve.isPending} onClick={() => void onApprove()}>
          {selected.length < request.scopes.length ? `Approve ${selected.length}/${request.scopes.length}` : 'Approve'}
        </Button>
      </div>
      {confirmer.dialog}
    </div>
  );
}

export function AccessRequestsGroup({ requests, onError }: { requests: readonly ScopeRequestSummary[]; onError: OnError }) {
  if (requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="security-requests">
      <SectionHeader title="Pending access requests" level={3} count={requests.length} countTone="warn" />
      <div className="overflow-hidden rounded-panel border border-line bg-raised">
        {requests.map((r) => (
          <RequestRow key={r.requestId} request={r} onError={onError} />
        ))}
      </div>
    </section>
  );
}

function CapabilitiesMenu({ device, onError }: { device: DeviceSummary; onError: OnError }) {
  const setScopes = useSetDeviceScopes();
  const confirmer = useConfirm();

  const toggle = async (scope: string, grant: boolean) => {
    if (grant && isSensitiveScope(scope)) {
      const ok = await confirmer.confirm({
        title: `Allow "${device.name}" to ${sensitiveGrantText([scope])}?`,
        description: 'This takes effect the next time that device refreshes its session.',
        confirmLabel: 'Allow',
      });
      if (!ok) return;
    }
    const scopes = grant ? [...new Set([...device.scopes, scope])] : device.scopes.filter((s) => s !== scope);
    setScopes.mutate({ deviceId: device.deviceId, scopes }, { onError });
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={<IconButton size="sm" icon="key" label={`Capabilities of ${device.name}`} loading={setScopes.isPending} />}
        />
        <Menu.Popup align="end">
          <Menu.Group>
            <Menu.GroupLabel>Capabilities</Menu.GroupLabel>
            {GRANTABLE_CAPABILITIES.map((cap) => (
              <Menu.CheckboxItem
                key={cap.scope}
                checked={device.scopes.includes(cap.scope)}
                onCheckedChange={(on) => void toggle(cap.scope, on)}
                description={cap.hint}
              >
                {cap.label}
              </Menu.CheckboxItem>
            ))}
          </Menu.Group>
        </Menu.Popup>
      </Menu.Root>
      {confirmer.dialog}
    </>
  );
}

export function PairedDevicesGroup({
  devices,
  isPending,
  onError,
}: {
  devices: readonly DeviceSummary[] | undefined;
  isPending: boolean;
  onError: OnError;
}) {
  const revoke = useRevokeDevice();
  const confirmer = useConfirm();
  const active = (devices ?? []).filter((d) => !d.revokedAt);
  const revoked = (devices ?? []).filter((d) => d.revokedAt);

  const onRevoke = async (d: DeviceSummary) => {
    const ok = await confirmer.confirm({
      title: `Revoke "${d.name}"?`,
      description:
        'It loses access immediately and must be paired again. If it is connected through the relay, the revocation is delivered as soon as the relay is reachable.',
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (ok) revoke.mutate(d.deviceId, { onError });
  };

  const columns: SettingsTableColumn<DeviceSummary>[] = [
    {
      id: 'device',
      header: 'Device',
      width: '1fr',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <Icon concept={PLATFORM_ICON[d.platform] ?? 'key'} size={14} className="shrink-0 text-fg-3" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-fg">{d.name}</span>
            <span className="truncate text-small text-fg-3">
              {PLATFORM_LABEL[d.platform] ?? d.platform}
              {d.relayBound ? ' · relay' : ''}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'scopes',
      header: 'Scopes',
      width: 160,
      cell: (d) => {
        const level = accessLevel(d.scopes);
        return (
          <span className="flex min-w-0 flex-col">
            <Badge tone={level.tone} className="self-start">
              {level.label}
            </Badge>
            <Tooltip content={d.scopes.join(', ')}>
              <span className="truncate font-mono text-micro text-fg-3" tabIndex={0}>
                {d.scopes.length} scope{d.scopes.length === 1 ? '' : 's'}
              </span>
            </Tooltip>
          </span>
        );
      },
    },
    {
      id: 'seen',
      header: 'Seen',
      width: 64,
      mono: true,
      cell: (d) => (
        <Tooltip content={d.lastSeenTransport ? `Last seen over ${d.lastSeenTransport} · credential v${d.credentialVersion}` : `Credential v${d.credentialVersion}`}>
          <span tabIndex={0}>{relativeTime(d.lastSeenAt)}</span>
        </Tooltip>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-2" data-testid="security-devices">
      <SectionHeader title="Paired devices" level={3} count={devices ? active.length : undefined} hint="Revoking one never affects the others" />
      <SettingsTable
        label="Paired devices"
        columns={columns}
        rows={active}
        getRowId={(d) => d.deviceId}
        actionsWidth={112}
        empty={<p className="text-small text-fg-3">{isPending ? 'Loading…' : 'No devices are paired yet.'}</p>}
        rowActions={(d) => (
          <span className="flex items-center justify-end gap-1">
            <CapabilitiesMenu device={d} onError={onError} />
            <Button size="sm" variant="danger-ghost" onClick={() => void onRevoke(d)}>
              Revoke
            </Button>
          </span>
        )}
      />
      {revoked.length > 0 ? (
        <Collapsible trigger={`${revoked.length} revoked device${revoked.length === 1 ? '' : 's'}`}>
          <ul className="flex flex-col gap-1 pt-1">
            {revoked.map((d) => (
              <li key={d.deviceId} className="flex items-center gap-2 text-small text-fg-3">
                <Icon concept="shield" size={12} />
                <span className="line-through">{d.name}</span>
                <span>revoked {ago(d.revokedAt)}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
      {confirmer.dialog}
    </section>
  );
}
