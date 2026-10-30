// MP-34 OfflineState (03 MP-34; MD-25, MD-89). `banner`: a strip under the header (min 36, bg-selected, never
// tinted) with the server glyph — "Offline · showing saved data", "Reconnecting…" (spinner) or "Can't reach <server>"
// — and a ghost Retry; a polite live region. `screen`: EmptyState geometry, "Can't reach <server>", the address in
// mono, Retry and Switch server.
import React from 'react';
import { View } from 'react-native';

import { nativePlatform } from '../../platform/geometry';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Spinner } from '../Spinner';
import { Text } from '../Text';
import type { OfflineStateProps } from './OfflineState.types';
import { offlineText } from './offlineModel';

export type { OfflineStateProps } from './OfflineState.types';

export function OfflineState({ form, state, serverName, address, onRetry, onSwitchServer, testID }: OfflineStateProps): React.ReactElement {
  const text = offlineText({ state, serverName });
  if (form === 'banner') {
    return (
      <View testID={testID} accessibilityLiveRegion="polite" className="min-h-9 flex-row items-center gap-2 bg-selected pe-1 ps-4">
        {state === 'reconnecting' ? <Spinner size={14} tone="fg-2" /> : <Icon concept="server" size={14} tone="fg-2" />}
        <Text role="footnote" tone="fg-2" numberOfLines={1} className="flex-1" accessibilityRole="text">
          {text}
        </Text>
        {onRetry && state !== 'reconnecting' ? <Button label="Retry" variant="ghost" size="sm" onPress={onRetry} /> : null}
      </View>
    );
  }
  return (
    <View testID={testID} accessibilityLiveRegion="polite" className="items-center gap-1.5 px-8 py-12">
      <Icon concept="server" size={nativePlatform === 'android' ? 24 : 22} tone="fg-3" />
      <Text role="headline" align="center" accessibilityRole="header">
        {offlineText({ state: 'unreachable', serverName })}
      </Text>
      {address ? (
        <Text role="mono" tone="fg-3" align="center" selectable>
          {address}
        </Text>
      ) : null}
      <View className="flex-row gap-2 pt-2.5">
        {onRetry ? <Button label="Retry" variant="ghost" icon="retry" onPress={onRetry} /> : null}
        {onSwitchServer ? <Button label="Switch server" onPress={onSwitchServer} /> : null}
      </View>
    </View>
  );
}
