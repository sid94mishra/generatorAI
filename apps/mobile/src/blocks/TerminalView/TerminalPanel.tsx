// MB-27 Terminal tab (MPaneTerminal, MPaneTerminalFull): the workspace's shells as ML-08 instance chips ("Terminal",
// "Terminal 2" … up to DOCK_TAB_CAPS.terminal; "+" New terminal, hidden at the cap; ✕ closes after the host confirms
// the kill) plus a read-only "Agent commands N" view of the shell commands the agent ran. Every visited shell stays
// mounted with its socket while the chat is open (MD-24) — switching chips, hiding the pane or rotating never drops a
// screen. Gated on `exec:terminal` (Request access) and the biometric step-up for a user shell (only while the tab is
// on screen). The tab lifts with the software keyboard so the prompt stays visible.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { DOCK_TAB_CAPS } from '@generatorai/shared/ui-contract';
import type { ToolCallBlock } from '@generatorai/client-core';

import { LockedTab, StepUpTab } from '../WorkspacePane/TabGates';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { useAdminApi } from '../../services/api/useAdminApi';
import { useApi } from '../../services/api/useApi';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { forgetTerminal } from '../../services/terminal/terminalFocus';
import { PaneTabStrip } from '../../ui/layout/PaneTabStrip';
import { haptic } from '../../ui/platform/haptics';
import { useInsets } from '../../ui/platform/insets';
import { useKeyboardOverlap } from '../../ui/platform/keyboard';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { toast } from '../../ui/primitives/Toast';
import { AgentCommands } from './AgentCommands';
import { agentConsoleRows } from './engine/agentConsoleRows';
import { terminalLabel } from './model/keyRow';
import { TerminalView } from './TerminalView';

const CAP = DOCK_TAB_CAPS.terminal;
const AGENT_TAB = 'agent';

interface Shell {
  /** Stable key: survives a restart, which swaps the session id. */
  key: string;
  sessionId: string;
  exited?: boolean;
  initialInput?: string;
}

export interface TerminalPanelProps {
  workspaceId: string | null;
  /** The tab is on screen. */
  active: boolean;
  /** The agent is running a turn. */
  agentBusy?: boolean;
  /** The shell commands the agent ran in this chat (the "Agent commands" view). */
  agentCalls?: readonly ToolCallBlock[];
}

export function TerminalPanel(props: TerminalPanelProps): React.ReactElement {
  const scopes = useGrantedScopes();
  const feature = checkFeature('terminal', scopes);
  if (!props.workspaceId) return <EmptyState icon="terminal" title="No workspace yet" description="A workspace is created the first time the agent runs here." />;
  if (!feature.available) return <LockedTab title="Terminal" feature={feature} scope="exec:terminal" />;
  return (
    <StepUpTab reason="Confirm opening a terminal" active={props.active}>
      <Shells {...props} workspaceId={props.workspaceId} />
    </StepUpTab>
  );
}

function Shells({ workspaceId, active, agentBusy = false, agentCalls = [] }: TerminalPanelProps & { workspaceId: string }): React.ReactElement {
  const api = useApi();
  const admin = useAdminApi();
  const insets = useInsets();
  const keyboard = useKeyboardOverlap();
  const fullscreen = usePaneStore((s) => s.fullscreen);
  const [shells, setShells] = useState<Shell[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const seq = useRef(0);
  const commands = agentConsoleRows(agentCalls);

  const create = useCallback(
    async (initialInput?: string) => {
      setCreating(true);
      try {
        // 80×24 is a placeholder: the renderer resizes to its real geometry at once.
        const created = await api.terminals.create(workspaceId, { cols: 80, rows: 24 });
        seq.current += 1;
        const shell: Shell = { key: `shell-${seq.current}`, sessionId: created.id, ...(initialInput ? { initialInput } : {}) };
        setShells((prev) => [...(prev ?? []), shell]);
        setCurrent(shell.key);
        haptic('selection');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        haptic('error');
        toast({ kind: 'error', message: /INSUFFICIENT_SCOPE|403/.test(message) ? 'This device may not open terminals.' : /429|cap \(/.test(message) ? 'The server has reached its terminal limit.' : `Couldn't open a terminal: ${message}` });
      } finally {
        setCreating(false);
      }
    },
    [api, workspaceId],
  );

  // Seed from the server: shells opened elsewhere (the desktop, another phone) are the same sessions.
  useEffect(() => {
    let cancelled = false;
    admin.terminals
      .list(encodeURIComponent(workspaceId))
      .then((list) => {
        if (cancelled) return;
        const alive = list
          .filter((d) => d.exitCode === null)
          .slice(0, CAP)
          .map<Shell>((d, i) => ({ key: `seed-${i}-${d.id}`, sessionId: d.id }));
        setShells(alive);
        setCurrent(alive[0]?.key ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
    // Once per workspace; the strip owns its state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const close = useCallback(
    async (key: string) => {
      const list = shells ?? [];
      const index = list.findIndex((s) => s.key === key);
      const shell = list[index];
      if (!shell || closing) return;
      setClosing(key);
      try {
        // The chip stays until the host confirms: hiding a failed kill orphaned a running shell.
        await api.terminals.kill(workspaceId, shell.sessionId);
        forgetTerminal(workspaceId, shell.sessionId);
        const next = list.filter((s) => s.key !== key);
        setShells(next);
        setCurrent((c) => (c === key ? (next[Math.min(index, next.length - 1)]?.key ?? null) : c));
        haptic('warning');
      } catch (err) {
        toast({ kind: 'error', message: `Couldn't close the terminal: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        setClosing(null);
      }
    },
    [api, closing, shells, workspaceId],
  );
  const update = useCallback((key: string, patch: Partial<Shell>) => setShells((prev) => prev?.map((s) => (s.key === key ? { ...s, ...patch } : s)) ?? prev), []);
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.value, insets.bottom) }), [insets.bottom]);

  if (error) return <ErrorState title="Terminal unavailable" error={error} onRetry={() => setError(null)} />;
  if (shells === null) {
    return (
      <View className="p-4" accessibilityLabel="Listing terminals">
        <Skeleton preset="list" count={2} />
      </View>
    );
  }

  const showingAgent = current === AGENT_TAB;
  const chips = [
    ...shells.map((s, i) => ({ id: s.key, type: 'terminal' as const, label: s.exited ? `${terminalLabel(i)} (exited)` : terminalLabel(i), icon: 'terminal' as const, closable: true })),
    ...(commands.length > 0 ? [{ id: AGENT_TAB, type: 'terminal' as const, label: 'Agent commands', icon: 'tool' as const, count: commands.length }] : []),
  ];

  return (
    <Animated.View className="flex-1" style={lift}>
      {chips.length > 0 ? (
        <PaneTabStrip
          variant="instanceChips"
          tabs={chips}
          active={current ?? ''}
          onSelect={setCurrent}
          onClose={(id) => void close(id)}
          {...(shells.length < CAP && !creating ? { onAdd: () => void create(), addLabel: 'New terminal' } : {})}
          accessibilityLabel="Terminals"
        />
      ) : null}
      {shells.length === 0 && !showingAgent ? (
        <EmptyState icon="terminal" title="No terminal open" description="A shell runs on the machine hosting GeneratorAI, in this workspace's folder." action={{ label: creating ? 'Opening…' : 'New terminal', icon: 'plus', onPress: () => void create() }} />
      ) : null}
      {shells.map((shell) => {
        const on = shell.key === current;
        return (
          <View key={shell.key} pointerEvents={on ? 'auto' : 'none'} accessibilityElementsHidden={!on} importantForAccessibility={on ? 'auto' : 'no-hide-descendants'} className={on ? 'flex-1' : 'absolute inset-0 opacity-0'}>
            <TerminalView
              workspaceId={workspaceId}
              sessionId={shell.sessionId}
              active={active && on}
              agentBusy={agentBusy}
              fullscreen={fullscreen}
              {...(shell.initialInput ? { initialInput: shell.initialInput } : {})}
              onSessionChange={(d) => update(shell.key, { sessionId: d.id, exited: false })}
              onExit={() => update(shell.key, { exited: true })}
            />
          </View>
        );
      })}
      {showingAgent ? (
        <AgentCommands
          rows={commands}
          {...(shells.length < CAP ? { onOpenInTerminal: (command: string) => void create(command) } : {})}
        />
      ) : null}
      {shells.length > 0 && current === null ? (
        <View className="flex-1 items-center justify-center p-4">
          <Button label="New terminal" icon="plus" onPress={() => void create()} />
        </View>
      ) : null}
    </Animated.View>
  );
}
