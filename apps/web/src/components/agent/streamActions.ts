// ────────────────────────────────────────────────────────────────
// streamActions — click-through affordances for timeline steps.
//
// A context rather than props: TimelineStep is pure data shared by several
// surfaces (chat stream, history messages, workflow stages), and threading
// two callbacks through every one of them for the benefit of two small
// icon buttons would couple all of those surfaces to ChatPage's pane
// wiring. Surfaces that don't provide the context simply render no icons.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';

export interface StreamActions {
  /** Open the Changes tab (optionally scrolled to one file). */
  onOpenChanges?: (filePath?: string) => void;
  /** Open the integrated terminal's agent-command console at one call. */
  onOpenShell?: (callId: string) => void;
  /** Workspace the transcript belongs to — resolves agent screenshot URLs. */
  workspaceId?: string;
}

/** URL of a browser artifact (`browser/…` under the workspace root). */
export function browserArtifactUrl(workspaceId: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/files/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

export const StreamActionsContext = createContext<StreamActions>({});

export function useStreamActions(): StreamActions {
  return useContext(StreamActionsContext);
}
