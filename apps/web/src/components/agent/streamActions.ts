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
}

export const StreamActionsContext = createContext<StreamActions>({});

export function useStreamActions(): StreamActions {
  return useContext(StreamActionsContext);
}
