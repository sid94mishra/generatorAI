// The Settings affordance, in one place so all four tabs agree on its icon,
// label and destination. Drawn in the foreground colour: in muted grey it
// read as a disabled control.

import React from 'react';
import { router } from 'expo-router';
import { Settings } from 'lucide-react-native';

import { IconButton } from './Button';
import { useTheme } from '../../theme/ThemeProvider';

export function SettingsButton(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <IconButton
      accessibilityLabel="Settings"
      icon={<Settings size={20} color={colors.foreground} />}
      onPress={() => router.push('/settings')}
    />
  );
}
