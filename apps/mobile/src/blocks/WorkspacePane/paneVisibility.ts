// Where the pane may show (03 MB-42; 04 §1.3 "pushed from pane"). Pure.
import { isPresentedRoute } from '../../services/navigation/presentedRoutes';

/**
 * True on the claiming screen and the workspace screens pushed from it (diff, file) — but not under a presented
 * route (the commit sheet is under /workspaces too): on Android a route sheet renders inside the stack, below the
 * shell's pane, so the pane hid the sheet it had opened (MD-198).
 */
export function paneVisibleOn(pathname: string, claimPath: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  if (isPresentedRoute(path)) return false;
  return path === claimPath || /^\/workspaces\//.test(path);
}
