// MP-35 PermissionState (03 MP-35; MDF-136 R-OSPERM / R-SCOPE): EmptyState geometry for an OS permission or a server
// scope — glyph, one-sentence why, and the one action the status allows: "Allow" (undetermined), "Open Settings"
// (denied), "Request access" (missing scope), "Unlock" (the app-lock overlay, testID `app-lock`). Platform nouns
// ("Face ID" / "fingerprint") come from ui/platform/nouns.
import React from 'react';
import { Linking, View } from 'react-native';

import { nativePlatform } from '../../platform/geometry';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Text } from '../Text';
import type { PermissionStateProps } from './PermissionState.types';
import { permissionCopy } from './permissionModel';

export type { PermissionKind, PermissionStateProps, PermissionStatus } from './PermissionState.types';

export function PermissionState({ kind, status, scope, onRequest, onOpenSettings, testID }: PermissionStateProps): React.ReactElement {
  const copy = permissionCopy(kind, status, scope);
  const act = copy.action?.kind === 'settings' ? (onOpenSettings ?? (() => void Linking.openSettings())) : onRequest;
  return (
    <View testID={testID ?? (kind === 'app-lock' ? 'app-lock' : undefined)} className="items-center gap-1.5 px-8 py-12">
      <Icon concept={copy.icon} size={nativePlatform === 'android' ? 24 : 22} tone="fg-3" />
      <Text role="headline" align="center" accessibilityRole="header">
        {copy.title}
      </Text>
      {copy.body ? (
        <Text role="subhead" tone="fg-3" align="center" className="max-w-67.5">
          {copy.body}
        </Text>
      ) : null}
      {copy.action && act ? (
        <View className="pt-2.5">
          <Button label={copy.action.label} onPress={act} />
        </View>
      ) : null}
    </View>
  );
}
