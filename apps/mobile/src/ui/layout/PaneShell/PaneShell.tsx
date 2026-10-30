// ML-07 PaneShell (03 ML-07; MPaneOpen, MPaneChanges; MD-23, MD-54, MD-82): the workspace pane's frame inside the end
// SidePanel — the h-panel-bar 52 header ("Workspace" + the chat or run title, Open / Exit full screen, Close pane;
// IconButton md 44 / 48), the tab strip, an optional toolbar, the body and an optional footer. In full screen the
// header gains "Back to chat" and keeps the tab strip (full screen is a mode, never a route). The panel pays the
// top inset when it spans the window; the bottom inset is paid under the footer / body.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { nativePlatform } from '../../platform/geometry';
import { useInsets } from '../../platform/insets';
import { IconButton } from '../../primitives/IconButton';
import { Text } from '../../primitives/Text';
import type { PaneShellProps } from './PaneShell.types';

export type { PaneShellProps } from './PaneShell.types';

export function PaneShell({ title, subtitle, mode, onToggleFullscreen, onClose, onBackToChat, backToLabel = 'Back to chat', tabs, toolbar, footer, children, testID }: PaneShellProps): React.ReactElement {
  const insets = useInsets();
  const fullscreen = mode === 'fullscreen';
  return (
    <View testID={testID} className="flex-1" style={{ paddingTop: insets.top }}>
      <View className={cn('min-h-panel-bar flex-row items-center gap-1', nativePlatform === 'android' ? 'pe-1 ps-4' : 'pe-2 ps-5', fullscreen && 'ps-1')}>
        {fullscreen && onBackToChat ? <IconButton icon="back" label={backToLabel} onPress={onBackToChat} testID="pane-back" /> : null}
        <View className="min-w-0 flex-1">
          <Text role="detailTitle" accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text role="caption" tone="fg-3" numberOfLines={1} chrome>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton icon={fullscreen ? 'minimize' : 'maximize'} label={fullscreen ? 'Exit full screen' : 'Open full screen'} onPress={onToggleFullscreen} testID="pane-fullscreen" />
        <IconButton icon="x" label="Close pane" onPress={onClose} testID="pane-close" />
      </View>
      {tabs}
      {toolbar ? <View className="min-h-control justify-center">{toolbar}</View> : null}
      <View className="flex-1">{children}</View>
      {footer ? <View style={{ paddingBottom: insets.bottom }}>{footer}</View> : null}
    </View>
  );
}
