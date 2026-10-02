// MB-20 ServerSwitcher — the trigger form (03 MB-20, ML-06 header): BrandMark 26, the server's name and where it
// runs ("This computer" / "Remote server"), and the ⌃⌄ glyph when it opens the switcher.
import React from 'react';
import { View } from 'react-native';

import { useAuth } from '../../services/auth/AuthProvider';
import { BrandMark } from '../../ui/primitives/BrandMark';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Text } from '../../ui/primitives/Text';

export function useActiveServer(): { name: string; where: string } {
  const { servers, serverId } = useAuth();
  const server = servers.find((s) => s.serverId === serverId);
  return { name: server?.label || 'GeneratorAI', where: server?.kind === 'local' ? 'This computer' : 'Remote server' };
}

export function ServerSwitcherTrigger({ onPress }: { onPress?: () => void }): React.ReactElement {
  const { name, where } = useActiveServer();
  const body = (
    <>
      <BrandMark mark="app" size={26} />
      <View className="min-w-0 flex-shrink">
        <Text role="headline" numberOfLines={1} chrome>
          {name}
        </Text>
        <Text role="caption" tone="fg-3" numberOfLines={1} chrome>
          {where}
        </Text>
      </View>
      {onPress ? <Icon concept="expand-all" size={14} tone="fg-3" /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${name}, ${where}`} className="min-h-icon-button min-w-0 flex-1 flex-row items-center gap-2.5">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID="server-switcher-trigger"
      onPress={onPress}
      frame="none"
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${where}`}
      accessibilityHint="Switches server"
      className="min-h-icon-button min-w-0 flex-1 flex-row items-center gap-2.5"
    >
      {body}
    </Pressable>
  );
}
