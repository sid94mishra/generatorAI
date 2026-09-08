// ────────────────────────────────────────────────────────────────
// Workbench › Terminal.
//
// The same tab host the full-screen route uses. Reaching it from the chat
// matters more than the standalone screen does: the usual reason to look at a
// terminal on a phone is to see what the agent just ran.
//
// The session pager pre-mounts this as the neighbour of the Changes pane, so
// the biometric step-up is keyed on `active`: the prompt appears when the
// pane is actually swiped into view, not while it sits off-screen. Once
// confirmed, `TerminalTabs` leaves its sessions alive on the server, so
// switching panes and back re-attaches to the same shells.
// ────────────────────────────────────────────────────────────────

import React from 'react';

import { StepUpGate } from '../../../auth/StepUpGate';
import { TerminalTabs } from '../../../terminal/TerminalTabs';

export function TerminalSection({
  workspaceId,
  active = true,
}: {
  workspaceId: string;
  /** Whether the pane is the visible page; gates the step-up prompt. */
  active?: boolean;
}): React.ReactElement {
  return (
    <StepUpGate reason="Confirm opening a terminal" active={active}>
      <TerminalTabs workspaceId={workspaceId} />
    </StepUpGate>
  );
}
