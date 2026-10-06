// ────────────────────────────────────────────────────────────────
// F-settings-14 Security & devices (board SettingsSecurity; D-42). Split from
// the legacy 1,420-line Security.tsx into one group per concern:
//   Servers · This server · Network exposure · Pending access requests ·
//   Paired devices · Pair a new device
// Data comes from hooks/securityQueries.ts (polled every 30 s while visible)
// and hooks/serverQueries.ts. A failed action shows its server message in
// the error callout at the top — it names the exact thing to fix.
// ────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import {
  securityErrorMessage,
  useDevices,
  useNetworkAccess,
  usePendingPairings,
  useRefreshSecurity,
  useScopeRequests,
  useSecurityPosture,
} from '@/hooks/securityQueries.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { ServersGroup } from './ServersGroup.js';
import { NetworkExposureGroup, ThisServerGroup } from './ServerPosture.js';
import { AccessRequestsGroup, PairedDevicesGroup } from './DevicesGroups.js';
import { PairDeviceGroup } from './PairDeviceGroup.js';

export function SecuritySection() {
  const posture = useSecurityPosture();
  const network = useNetworkAccess();
  const devices = useDevices();
  const pending = usePendingPairings();
  const requests = useScopeRequests();
  const refresh = useRefreshSecurity();
  const [actionError, setActionError] = useState<string | null>(null);
  const onError = (err: unknown) => setActionError(securityErrorMessage(err));
  // A failed action may be far below the callout: bring the message into view.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (actionError) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [actionError]);

  const loadError = [posture, network, devices, pending, requests].find((q) => q.error)?.error;
  const error = actionError ?? (loadError ? securityErrorMessage(loadError) : null);

  return (
    <SettingsSection
      title="Security & devices"
      description="Which servers this app talks to, who can reach this one, and what each paired device may do."
    >
      {error ? (
        <Callout
          ref={errorRef}
          role="alert"
          tone="err"
          action={actionError ? <IconButton size="sm" icon="x" label="Dismiss" onClick={() => setActionError(null)} /> : null}
        >
          {error}
        </Callout>
      ) : null}
      <ServersGroup />
      <ThisServerGroup posture={posture} network={network.data} onRefresh={refresh} />
      <NetworkExposureGroup network={network.data} isPending={network.isPending} onError={onError} />
      <AccessRequestsGroup requests={requests.data ?? []} onError={onError} />
      <PairedDevicesGroup devices={devices.data} isPending={devices.isPending} onError={onError} />
      <PairDeviceGroup posture={posture.data} pending={pending.data ?? []} onError={onError} />
    </SettingsSection>
  );
}
