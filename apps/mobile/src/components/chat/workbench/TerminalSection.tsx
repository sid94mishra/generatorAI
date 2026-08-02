// ────────────────────────────────────────────────────────────────
// Workbench › Terminal.
//
// The same renderer the full-screen route uses. Reaching it from the chat
// matters more than the standalone screen does: the usual reason to look at a
// terminal on a phone is to see what the agent just ran.
// ────────────────────────────────────────────────────────────────

import React from 'react';

import { TerminalView } from '../../../terminal/TerminalView';

export function TerminalSection({ workspaceId }: { workspaceId: string }): React.ReactElement {
  return <TerminalView workspaceId={workspaceId} />;
}
