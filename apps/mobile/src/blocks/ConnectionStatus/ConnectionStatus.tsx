// MB-43 ConnectionStatus (03 MB-43; MSidebar, MHome; MD-89): the connection, in two forms.
// - footer (drawer): StatusDot + "Connected" + the mono address; "Reconnecting…" with a spinner; "Disconnected".
// - banner (under the header, above the Stack): drives MP-34 OfflineState ("Offline · showing saved data" + Retry,
//   "Reconnecting…") and, when the server refused a scope this device lacks, a warn Callout banner with Retry (which
//   re-mints the token and re-asks). It never tints the header. Replaces the legacy ConnectionStrip.
import React, { useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { HEALTH } from '@generatorai/shared';

import { useAuth } from '../../services/auth/AuthProvider';
import { resumeApp } from '../../services/stream/lifecycle';
import { useMuxStream } from '../../services/stream/MuxStreamProvider';
import { describeNotice, useStreamHealth } from '../../services/stream/streamHealth';
import { Callout } from '../../ui/primitives/Callout';
import { OfflineState } from '../../ui/primitives/OfflineState';
import { Spinner } from '../../ui/primitives/Spinner';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { connectionAddress, connectionHealth } from './connectionModel';

export function useConnectionHealth(): { health: ReturnType<typeof connectionHealth>; address: string | null } {
  const { transport } = useAuth();
  const stream = useStreamHealth((s) => s.connection);
  return { health: connectionHealth(transport, stream), address: connectionAddress(transport) };
}

export function ConnectionFooter({ testID = 'connection-status' }: { testID?: string }): React.ReactElement {
  const { health, address } = useConnectionHealth();
  const word = health === 'reconnecting' ? `${HEALTH.connection.reconnecting.label}…` : HEALTH.connection[health].label;
  return (
    <View accessibilityRole="text" testID={testID} accessible accessibilityLabel={[word, address].filter(Boolean).join(', ')} className="min-w-0 flex-1 flex-row items-center gap-2">
      {health === 'reconnecting' ? <Spinner size={12} tone="warn" /> : <StatusDot health={HEALTH.connection[health].tone} size="sm" />}
      <Text role="subhead" tone="fg-2" chrome numberOfLines={1}>
        {word}
      </Text>
      {address ? (
        <Text role="monoSm" tone="fg-3" chrome numberOfLines={1} className="flex-shrink">
          {address}
        </Text>
      ) : null}
    </View>
  );
}

export function ConnectionBanner(): React.ReactElement | null {
  const connection = useStreamHealth((s) => s.connection);
  const attempt = useStreamHealth((s) => s.attempt);
  const rejected = useStreamHealth((s) => s.rejectedScopes);
  const clearRejected = useStreamHealth((s) => s.clearRejected);
  const stream = useMuxStream();
  const { refreshPermissions } = useAuth();
  const [busy, setBusy] = useState(false);
  const notice = describeNotice(connection, attempt, rejected);
  const message = notice?.message;

  // `accessibilityLiveRegion` is Android-only; VoiceOver needs the outage spoken.
  React.useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  if (!notice) return null;
  if (notice.kind === 'offline') return <OfflineState form="banner" state="offline" onRetry={() => resumeApp()} testID="connection-banner" />;
  if (notice.kind === 'reconnecting') return <OfflineState form="banner" state="reconnecting" testID="connection-banner" />;
  const retry = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      // Scopes travel inside the access token: a grant made elsewhere is invisible until it is re-minted.
      await refreshPermissions();
      stream?.resetRejections();
      clearRejected();
    } finally {
      setBusy(false);
    }
  };
  return <Callout form="banner" tone="warn" title={notice.message} action={{ label: 'Retry', onPress: () => void retry() }} testID="connection-banner" />;
}
