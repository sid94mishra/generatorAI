// ML-17 AdaptiveLayout (03 ML-17; 06 §1.3, §1.4; MD-24; MTabletIOS, MTabletAndroid): the shell's one stable tree —
// [start panel][main column][end panel] — for every window size. It reads the size class from the window (never the
// device idiom) and hands each panel its presentation; a size-class change (rotation, Split View, Stage Manager,
// Android free-form windows, a fold) changes only that presentation, never the tree, so the terminal, WebViews and
// the transcript never remount. The main column pays the given insets once and leaves the accessibility tree while
// the drawer is open over it.
import React from 'react';
import { View, useWindowDimensions } from 'react-native';

import { geometry } from '../../platform/geometry';
import { sizeClassFor } from '../../platform/breakpoints';
import type { AdaptiveLayoutProps } from './AdaptiveLayout.types';
import { adaptivePresentations, fullscreenWidth } from './adaptiveModel';

export type { AdaptiveLayoutProps, PanelSlot } from './AdaptiveLayout.types';

export function AdaptiveLayout({ start, end, startHidden, startOverlayOpen = false, endOpen, endFullscreen, mainInsets, children, testID }: AdaptiveLayoutProps): React.ReactElement {
  const { width } = useWindowDimensions();
  const sizeClass = sizeClassFor(width);
  const p = adaptivePresentations(sizeClass, { startHidden, endOpen, endFullscreen });
  const hideMain = startOverlayOpen && p.start === 'overlay';
  return (
    <View testID={testID} className="flex-1 flex-row bg-ground">
      <React.Fragment key="start">{start({ presentation: p.start })}</React.Fragment>
      <View
        key="main"
        testID={testID ? `${testID}-main` : undefined}
        className="flex-1 bg-surface"
        accessibilityElementsHidden={hideMain}
        importantForAccessibility={hideMain ? 'no-hide-descendants' : 'auto'}
        style={mainInsets ? { paddingTop: mainInsets.top, paddingLeft: p.start === 'persistent' ? 0 : mainInsets.left, paddingRight: p.end === 'persistent' ? 0 : mainInsets.right } : undefined}
      >
        {children}
      </View>
      <React.Fragment key="end">{end ? end({ presentation: p.end, ...(p.end === 'fullscreen' ? { width: fullscreenWidth(width, p.start, geometry().shell.sidebar) } : {}) }) : null}</React.Fragment>
    </View>
  );
}
