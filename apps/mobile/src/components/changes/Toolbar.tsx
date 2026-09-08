// The section toolbar band shared by every workbench pane. Mirrors web's
// `px-2 py-1.5` + bottom border.

import React from 'react';
import { View } from 'react-native';

export function Toolbar({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <View className="min-h-11 flex-row items-center gap-2 border-b border-border-muted px-3 py-1.5">
      {children}
    </View>
  );
}
