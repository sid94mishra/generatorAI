// ────────────────────────────────────────────────────────────────
// Terminal screen.
//
// A thin route around `TerminalTabs`, which is shared with the chat
// Workbench. Two copies of a PTY socket lifecycle is how one of them ends up
// leaking a connection.
//
// Gated on `exec:terminal`, which a paired mobile device does not hold by
// default. The gate is shown INSTEAD of the terminal rather than around it:
// a terminal that opens and then fails looks like a bug, not a permission.
//
// Then a local step-up (plan §5.1): the scope grant authorises the shell on
// the server; the biometric check is what stops an unlocked phone on a desk
// from opening one. `StepUpGate` prompts once per session.
//
// Accepts an optional `command` param (from the Agent Console's "Open in
// terminal"): it is typed into the new shell WITHOUT a newline, so the user
// still has to press Enter — a deep link must never execute anything.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { StepUpGate } from '../../src/auth/StepUpGate';
import { FeatureLocked } from '../../src/components/common/FeatureLocked';
import { TerminalTabs } from '../../src/terminal/TerminalTabs';

export default function TerminalScreen(): React.ReactElement {
  const { workspaceId, command } = useLocalSearchParams<{
    workspaceId: string;
    command?: string;
  }>();
  const { state } = useAuth();

  const gate = checkFeature('terminal', state.status === 'authenticated' ? state.scopes : []);
  if (!gate.available) return <FeatureLocked feature="Terminal" check={gate} />;

  return (
    <StepUpGate reason="Confirm opening a terminal">
      <TerminalTabs
        workspaceId={String(workspaceId)}
        {...(typeof command === 'string' && command.length > 0 ? { initialInput: command } : {})}
      />
    </StepUpGate>
  );
}
