// Security › Access from other devices (D-123). The default way to reach this
// server from a phone or another computer is "Connect with Tailscale": one
// click runs `tailscale serve` on the server's machine, and every device
// signed in to the same tailnet opens a private https:// address with a
// publicly trusted certificate — no certificate to install, any network.
// Network exposure (LAN, D-110's private CA) stays available under Advanced
// for offline networks; Tailscale does not need it.

import type { ReactNode } from 'react';
import {
  useSetTailscaleAccess,
  useTailscaleAccess,
  type NetworkAccess,
  type TailscaleAccessStatus,
} from '@/hooks/securityQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Collapsible } from '@/ui/primitives/Collapsible/Collapsible.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { NetworkExposureGroup } from './ServerPosture.js';
import { useCopied } from './CertificatePanel.js';
import { TAILSCALE_DOWNLOADS, TAILSCALE_HTTPS_HELP, TAILSCALE_STATE_BADGE } from './securityModel.js';

type OnError = (err: unknown) => void;

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2 text-small text-fg-2">
      <span className="w-4 shrink-0 font-mono text-fg-3">{n}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

function Downloads() {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {TAILSCALE_DOWNLOADS.map((d) => (
        <Link key={d.href} variant="external" href={d.href}>
          {d.label}
        </Link>
      ))}
    </span>
  );
}

/** What to do next, for every state but `on` and `ready`. */
function NextSteps({ status }: { status: TailscaleAccessStatus }) {
  switch (status.state) {
    case 'not-installed':
      return (
        <ol className="flex flex-col gap-1.5" data-testid="security-tailscale-steps">
          <Step n={1}>
            Install Tailscale on this computer — free for personal use (up to 6 users, unlimited devices): <Downloads />
          </Step>
          <Step n={2}>Open Tailscale and sign in.</Step>
          <Step n={3}>Install it on your phone or other computer and sign in with the same account.</Step>
          <Step n={4}>Come back here and click Connect with Tailscale.</Step>
        </ol>
      );
    case 'not-running':
      return <p className="text-small text-fg-2">Open Tailscale on this computer and connect, then check again.</p>;
    case 'needs-login':
      return (
        <p className="text-small text-fg-2">
          Sign in to Tailscale on this computer
          {status.loginUrl ? (
            <>
              {' '}
              (
              <Link variant="external" href={status.loginUrl}>
                sign in
              </Link>
              )
            </>
          ) : null}
          , then check again.
        </p>
      );
    case 'https-disabled':
      return (
        <p className="text-small text-fg-2">
          Tailscale needs HTTPS certificates turned on for your tailnet — one click in its admin console.{' '}
          {status.enableHttpsUrl ? (
            <Link variant="external" href={status.enableHttpsUrl}>
              Turn on HTTPS
            </Link>
          ) : null}{' '}
          <Link variant="external" href={TAILSCALE_HTTPS_HELP}>
            How
          </Link>
        </p>
      );
    default:
      return null;
  }
}

function TailscaleCard({ status, isFetching, onRefresh }: { status: TailscaleAccessStatus; isFetching: boolean; onRefresh: () => void }) {
  const set = useSetTailscaleAccess();
  const [copied, copy] = useCopied();
  const badge = TAILSCALE_STATE_BADGE[status.state];
  const admin = status.detail === 'full';
  const blocked = (status.blockers ?? []).length > 0;
  const canConnect = admin && !blocked && (status.state === 'ready' || status.state === 'https-disabled');
  // The 409 says why; the refetched status carries the same reason and Tailscale's link.
  const connect = (replace = false) => set.mutate({ enabled: true, ...(replace ? { replace } : {}) }, { onError: () => undefined });

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised p-4" data-testid="security-tailscale">
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium text-fg">Tailscale</span>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <span className="ml-auto">
          <IconButton size="sm" icon="refresh" label="Check Tailscale again" loading={isFetching} onClick={onRefresh} />
        </span>
      </div>

      {status.state === 'on' && status.origin ? (
        <>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-ui text-fg select-all" data-testid="security-tailscale-address">
              {status.origin}
            </span>
            <IconButton size="sm" icon={copied ? 'check' : 'copy'} label="Copy Tailscale address" onClick={() => copy(status.origin!)} />
          </div>
          <p className="text-small text-fg-2">
            Works on any network where your devices are signed in to Tailscale. Open it on the other device, then pair it below — no
            certificate warning, nothing to install.
          </p>
          {status.funnel ? (
            <Callout tone="warn" title="Tailscale Funnel is on for this address">
              Funnel publishes it to the whole internet, not just your devices. Devices still need a pairing code; turn Funnel off in
              Tailscale if you did not mean to.
            </Callout>
          ) : null}
        </>
      ) : status.state === 'on' ? (
        <p className="text-small text-fg-2">This server is reachable from devices signed in to Tailscale.</p>
      ) : (
        <p className="text-small text-fg-2">
          Free for personal use. Every device signed in to your Tailscale account opens this server at a private https:// address — no
          certificate to install, on any network. This computer stays closed to everything else.
        </p>
      )}

      {admin ? <NextSteps status={status} /> : null}

      {blocked ? (
        <Callout tone="warn" title="Fix this before other devices can connect">
          {(status.blockers ?? []).map((b) => (
            <span key={b.code} className="block">
              {b.message}
            </span>
          ))}
        </Callout>
      ) : null}

      {status.problem && status.state !== 'on' ? (
        <Callout tone="warn" data-testid="security-tailscale-problem">
          {status.problem}
        </Callout>
      ) : null}

      {status.conflict && status.state !== 'on' ? (
        <Callout
          tone="warn"
          title={status.conflict}
          action={
            <Button size="sm" disabled={!canConnect} loading={set.isPending} onClick={() => connect(true)}>
              Replace and connect
            </Button>
          }
        />
      ) : null}

      {admin ? (
        <div className="flex items-center gap-2">
          {status.enabled || status.state === 'on' ? (
            <Button variant="ghost" size="sm" loading={set.isPending} onClick={() => set.mutate({ enabled: false }, { onError: () => undefined })}>
              Turn off Tailscale access
            </Button>
          ) : null}
          {status.state !== 'on' && !status.conflict ? (
            <Button variant="primary" icon="link" disabled={!canConnect} loading={set.isPending} onClick={() => connect()}>
              Connect with Tailscale
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-small text-fg-3">Devices with admin:settings can turn this on or off.</p>
      )}
    </div>
  );
}

export function AccessGroup({ network, networkPending, onError }: { network: NetworkAccess | undefined; networkPending: boolean; onError: OnError }) {
  const tailscale = useTailscaleAccess();
  const lanOn = network?.mode === 'network-accessible' || network?.active === true;

  return (
    <section className="flex flex-col gap-2" data-testid="security-access">
      <SectionHeader title="Access from other devices" level={3} hint="Your phone and other computers, on any network" />
      {tailscale.data ? (
        <TailscaleCard status={tailscale.data} isFetching={tailscale.isFetching} onRefresh={() => void tailscale.refetch()} />
      ) : (
        <p className="text-small text-fg-3">{tailscale.isPending ? 'Checking Tailscale…' : 'Tailscale status is unavailable.'}</p>
      )}
      {/* Keyed so it opens once the read shows LAN exposure on (the read arrives after mount). */}
      <Collapsible key={lanOn ? 'lan-on' : 'lan-off'} trigger="Advanced: Network exposure (LAN)" defaultOpen={lanOn} data-testid="security-advanced">
        <p className="text-small text-fg-3">
          For networks without internet. Other devices on this network connect to this computer directly, and browsers warn about its
          own certificate until you install it.
        </p>
        <NetworkExposureGroup network={network} isPending={networkPending} onError={onError} />
      </Collapsible>
    </section>
  );
}
