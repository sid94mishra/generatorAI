// ────────────────────────────────────────────────────────────────
// Terminal screen.
//
// A thin route around `TerminalView`, which is shared with the chat
// Workbench. Two copies of a PTY socket lifecycle is how one of them ends up
// leaking a connection.
//
// Gated on `exec:terminal`, which a paired mobile device does not hold by
// default. The gate is shown INSTEAD of the terminal rather than around it:
// a terminal that opens and then fails looks like a bug, not a permission.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { FeatureLocked } from '../../src/components/common/FeatureLocked';
import { TerminalView } from '../../src/terminal/TerminalView';

export default function TerminalScreen(): React.ReactElement {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>();
  const { state } = useAuth();

  const gate = checkFeature('terminal', state.status === 'authenticated' ? state.scopes : []);
  if (!gate.available) return <FeatureLocked feature="Terminal" check={gate} />;

  return <TerminalView workspaceId={String(workspaceId)} />;
}
