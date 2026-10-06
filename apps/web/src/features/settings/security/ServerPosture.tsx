// Security › This server (posture) and Network exposure. The exposure control
// offers only what the server supports — loopback only or the local network
// (D-42: the board's "Custom" has no server mode and is not offered). While
// exposed, the addresses other devices use are https:// and the certificate
// they will be shown is described below them (D-110).

import type { UseQueryResult } from '@tanstack/react-query';
import {
  canRestartServer,
  useRestartServer,
  useSetNetworkAccess,
  type NetworkAccess,
  type SecurityPosture,
} from '@/hooks/securityQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { browserAddressFor, shortFingerprint, usableEndpoints } from './securityModel.js';
import { CertificateGroup } from './CertificatePanel.js';

export function ThisServerGroup({
  posture,
  network,
  onRefresh,
}: {
  posture: UseQueryResult<SecurityPosture>;
  network: NetworkAccess | undefined;
  onRefresh: () => void;
}) {
  const p = posture.data;
  // NON_LOOPBACK_BIND is the state Network exposure exists to produce; a
  // standing alarm for a deliberate choice is one people learn to ignore.
  const warnings = (p?.warnings ?? []).filter(
    (w) => !(w.code === 'NON_LOOPBACK_BIND' && network?.mode === 'network-accessible'),
  );
  const relayLabel = p
    ? p.relay.clientAvailable
      ? p.relay.enabled
        ? p.relay.state
        : 'disabled'
      : p.relay.enabled
        ? 'client unavailable'
        : 'disabled'
    : '';

  return (
    <section className="flex flex-col gap-2" data-testid="security-this-server">
      <SectionHeader
        title="This server"
        level={3}
        hint="What is protecting it right now"
        action={<IconButton size="sm" icon="refresh" label="Refresh" loading={posture.isFetching} onClick={onRefresh} />}
      />
      {p ? (
        <>
          <KeyValueList
            labelWidth={120}
            dense
            items={[
              {
                label: 'Authentication',
                value: (
                  <span className="flex items-center gap-1.5">
                    <Badge tone={p.authentication.required ? 'ok' : 'err'}>
                      {p.authentication.required ? 'Pairing required' : 'Disabled'}
                    </Badge>
                    {p.authentication.legacyApiKeyActive ? <Badge tone="warn">Legacy key active</Badge> : null}
                  </span>
                ),
              },
              {
                label: 'Secret storage',
                value: (
                  <span className="flex items-center gap-1.5">
                    <Badge tone={p.secretStore.secure ? 'ok' : 'err'}>{p.secretStore.secure ? 'Protected' : 'Weak'}</Badge>
                    <span className="font-mono text-small text-fg-3">{p.secretStore.kind}</span>
                  </span>
                ),
              },
              { label: 'Host identity', value: shortFingerprint(p.server.hostId), mono: true },
              {
                label: 'Relay',
                value: (
                  <Badge tone={p.relay.clientAvailable && p.relay.enabled ? (p.relay.state === 'attached' ? 'ok' : 'warn') : 'neutral'}>
                    {relayLabel}
                  </Badge>
                ),
              },
            ]}
          />
          {warnings.map((w) => (
            <Callout key={w.code} tone={w.severity === 'critical' ? 'err' : 'warn'}>
              {w.message}
            </Callout>
          ))}
        </>
      ) : (
        <p className="text-small text-fg-3">{posture.isPending ? 'Loading…' : 'Security posture is unavailable.'}</p>
      )}
    </section>
  );
}

export function NetworkExposureGroup({
  network,
  isPending,
  onError,
}: {
  network: NetworkAccess | undefined;
  isPending: boolean;
  onError: (message: unknown) => void;
}) {
  const setAccess = useSetNetworkAccess();
  const restart = useRestartServer();
  const pageOrigin = window.location.origin;

  if (!network) {
    return (
      <section className="flex flex-col gap-2" data-testid="security-network">
        <SectionHeader title="Network exposure" level={3} />
        <p className="text-small text-fg-3">{isPending ? 'Loading…' : 'Network access settings are unavailable.'}</p>
      </section>
    );
  }

  const locked = network.envOverride != null;
  const addresses = usableEndpoints(network.endpoints).map((e) => browserAddressFor(e.origin, pageOrigin));

  return (
    <section className="flex flex-col gap-2" data-testid="security-network">
      <SectionHeader
        title="Network exposure"
        level={3}
        action={
          <SegmentedControl
            label="Network exposure"
            value={network.mode}
            onValueChange={(mode) => setAccess.mutate(mode, { onError })}
            items={[
              { value: 'local-only', label: 'Loopback only', disabled: setAccess.isPending || locked, reason: locked ? 'Set by GENERATORAI_BIND_HOST' : undefined },
              { value: 'network-accessible', label: 'LAN', disabled: setAccess.isPending || locked, reason: locked ? 'Set by GENERATORAI_BIND_HOST' : undefined },
            ]}
          />
        }
      />
      <p className="text-small text-fg-3">
        Bound to <span className="font-mono text-fg-2">{network.bindHost}</span>
        {network.active ? ' · reachable from this network' : ' · only this computer can connect'}
      </p>

      {locked ? (
        <Callout tone="neutral">
          GENERATORAI_BIND_HOST is set to <span className="font-mono">{network.envOverride}</span> in this server's environment, so it
          decides the bind address and this setting cannot change it.
        </Callout>
      ) : null}

      {network.blockers.length > 0 ? (
        <Callout tone="warn" title="Fix this before enabling network access">
          {network.blockers.map((b) => (
            <span key={b.code} className="block">
              {b.message}
            </span>
          ))}
        </Callout>
      ) : null}

      {network.active ? (
        <Callout tone="warn" title={addresses.length > 0 ? undefined : 'No routable network address was detected'}>
          {addresses.length > 0 ? (
            <>
              Anything on this network can reach{' '}
              {addresses.map((a, i) => (
                <span key={a}>
                  {i > 0 ? ', ' : null}
                  <span className="font-mono select-all">{a}</span>
                </span>
              ))}
              . Devices still need a pairing code.
            </>
          ) : (
            'Connect to Wi-Fi or Ethernet.'
          )}
        </Callout>
      ) : null}

      {network.active && network.tls ? <CertificateGroup tls={network.tls} onError={onError} /> : null}

      {network.active && network.trustProxy.mode !== 'off' ? (
        <p className="text-small text-fg-3" data-testid="security-trust-proxy">
          Forwarded HTTPS headers are trusted from{' '}
          <span className="font-mono text-fg-2">
            {network.trustProxy.mode === 'loopback' ? 'a proxy on this computer' : network.trustProxy.addresses.join(', ')}
          </span>{' '}
          (GENERATORAI_TRUST_PROXY).
        </p>
      ) : null}

      {network.pendingRestart ? (
        <Callout
          tone="warn"
          title="Saved. Takes effect after the server restarts."
          action={
            canRestartServer() ? (
              <Button size="sm" icon="restart" loading={restart.isPending} onClick={() => restart.mutate(undefined, { onError })}>
                Restart server
              </Button>
            ) : null
          }
        >
          {canRestartServer() ? null : 'Restart the server to apply it — the bind address is fixed when the server starts.'}
        </Callout>
      ) : null}
    </section>
  );
}
