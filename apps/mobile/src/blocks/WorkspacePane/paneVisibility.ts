// Where the pane may show (03 MB-42; 04 §1.3 "pushed from pane"). Pure.
/** True on the claiming screen and the workspace screens pushed from it (diff, file; the legacy Changes / Terminal). */
export function paneVisibleOn(pathname: string, claimPath: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return path === claimPath || /^\/(workspaces|changes|terminal)\//.test(path);
}
