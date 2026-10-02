// MP-28 ContextMenu — iOS: a SwiftUI context menu through Expo UI: the row (hosted as RN content at its measured
// width) lifts into the system preview over the blurred scene, or the `preview` element when given; items as in
// MP-27. The row keeps its taps; the long-press belongs to the system. Accessibility actions mirror every item.
// Until the row is measured, and without the ExpoUI module, the JS path draws it.
import React, { useState } from 'react';
import { View } from 'react-native';

import { swiftUI } from '../expoUi.ios';
import { swiftMenuEntries } from '../Menu/Menu.ios';
import type { ContextMenuProps } from './ContextMenu.types';
import { ContextMenuJs } from './ContextMenuJs';
import { contextTargetProps } from './contextMenuModel';

export type { ContextMenuProps, ContextMenuTargetProps } from './ContextMenu.types';

export function ContextMenu(props: ContextMenuProps): React.ReactElement {
  const [width, setWidth] = useState(0);
  const { items, onSelect, preview, disabled = false, children, testID } = props;
  if (!swiftUI || disabled) return <ContextMenuJs {...props} />;
  const { ui } = swiftUI;
  const target = React.cloneElement(children, contextTargetProps({ items, onSelect }, children.props));
  return (
    <View testID={testID} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {width === 0 ? (
        target
      ) : (
        <ui.Host matchContents={{ vertical: true }} style={{ width }}>
          <ui.ContextMenu>
            <ui.ContextMenu.Trigger>
              <ui.RNHostView matchContents>
                <View style={{ width }}>{target}</View>
              </ui.RNHostView>
            </ui.ContextMenu.Trigger>
            {preview ? (
              <ui.ContextMenu.Preview>
                <ui.RNHostView matchContents>{preview}</ui.RNHostView>
              </ui.ContextMenu.Preview>
            ) : null}
            <ui.ContextMenu.Items>{swiftMenuEntries(swiftUI, items, onSelect)}</ui.ContextMenu.Items>
          </ui.ContextMenu>
        </ui.Host>
      )}
    </View>
  );
}
