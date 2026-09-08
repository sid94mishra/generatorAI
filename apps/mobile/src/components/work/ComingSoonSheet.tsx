// ────────────────────────────────────────────────────────────────
// ComingSoonSheet — an honest "New" for a segment that cannot create yet.
//
// A FAB that does nothing is a dead control; a FAB that opens a sheet
// saying exactly what lands in which phase, and where the thing can be made
// today, is not. This is what "New" on Workflows and Automations opens
// until authoring lands (plan §6.9 Builder-lite, Phase 5).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { Hammer } from 'lucide-react-native';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { useTheme } from '../../theme/ThemeProvider';

export function ComingSoonSheet({
  visible,
  onClose,
  title,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} fitContent keyboardAware={false}>
      <View className="items-center gap-3 px-6 pb-2 pt-4">
        <View className="h-14 w-14 items-center justify-center rounded-3xl bg-subtle">
          <Hammer size={22} color={colors['muted-foreground']} />
        </View>
        <Text className="text-center text-sm leading-relaxed text-muted-foreground">{message}</Text>
        <Button label="Got it" variant="secondary" full onPress={onClose} haptic="tap" />
      </View>
    </Sheet>
  );
}
