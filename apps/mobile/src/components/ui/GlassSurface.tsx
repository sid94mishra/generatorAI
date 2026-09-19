import React from 'react';
import { View, type ViewProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

/** Material surface on Android and web; UIKit glass lives in the iOS file. */
export function GlassSurface({ style, ...props }: ViewProps): React.ReactElement {
  const { colors } = useTheme();
  return <View {...props} style={[{ backgroundColor: colors.raised }, style]} />;
}
