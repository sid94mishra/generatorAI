// blocks/dock — the chat / run right dock (D-27; 03 §4 S-08/S-09; 06 §4.3).
export { Dock, DOCK_MIN_TWO_COLUMN_HOST, type DockProps } from './Dock.js';
export type { DockFocusRequest, DockPanelProps, DockRegistry, DockTabDef, DockTabInstance } from './dockRegistry.js';
export { mintTabId, type DockStoredState, type DockTabRef } from './dockState.js';
export { useDockOpen } from './useDockOpen.js';
export { useDockLinkParam } from './useDockLinkParam.js';
export { CAP_NOTICE_MS } from './useDockState.js';
