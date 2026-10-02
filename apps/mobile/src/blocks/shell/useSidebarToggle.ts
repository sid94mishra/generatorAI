// The header's sidebar toggle (MD-18, MD-24, 06 §1.3): phones open the drawer; tablets (≥ 600) hide or show the
// persistent sidebar, remembered per device.
import { useCallback } from 'react';

import { useSizeClass } from '../../ui/platform/breakpoints';
import { useShellStore } from './shellStore';

export function useSidebarToggle(): { onSidebarToggle: () => void; sidebarToggleState: 'drawer' | 'shown' | 'hidden' } {
  const { sizeClass } = useSizeClass();
  const hidden = useShellStore((s) => s.sidebarHidden);
  const onSidebarToggle = useCallback(() => {
    const s = useShellStore.getState();
    if (sizeClass === 'compact') s.toggleDrawer();
    else s.setSidebarHidden(!s.sidebarHidden);
  }, [sizeClass]);
  return { onSidebarToggle, sidebarToggleState: sizeClass === 'compact' ? 'drawer' : hidden ? 'hidden' : 'shown' };
}
