// ────────────────────────────────────────────────────────────────
// TerminalTabs — up to four shells per workspace, one on screen.
//
// Sessions are server-side resources (`GET /api/workspaces/:id/terminals`),
// so the strip is seeded from the server rather than from local state: a
// shell opened from the chat Workbench is still there when the full-screen
// route opens, and vice versa.
//
// Only the visible tab's `TerminalView` is `active`. The others keep their
// React state (title, exit banner) but drop their socket and WebView after
// a grace period — four live renderers on a phone is the memory budget of
// the whole app.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Plus, TerminalSquare, X } from 'lucide-react-native';
import type { TerminalDescriptor } from '@generatorai/client-core';

import { Chip } from '../components/ui/Chip';
import { IconButton } from '../components/ui/Button';
import { Touchable } from '../components/ui/Touchable';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { haptics } from '../components/ui/haptics';
import { useAuth } from '../auth/AuthProvider';
import { useApi } from '../api/useApi';
import { useTheme } from '../theme/ThemeProvider';
import { KeyboardSticky } from '../components/ui/KeyboardSticky';
import { TerminalView } from './TerminalView';
import { forgetTerminal } from './terminalFocus';

/** Same cap as the web's RightPane. */
export const MAX_TERMINAL_TABS = 4;

interface Tab {
  /** Stable React key — survives a restart, which swaps `sessionId`. */
  key: string;
  sessionId: string;
  title?: string;
  exited?: boolean;
  /** Typed into the shell on first attach, without a newline. */
  initialInput?: string;
}

export function TerminalTabs({
  workspaceId,
  initialInput,
}: {
  workspaceId: string;
  /** Opens a fresh shell with this pre-typed (never executed). */
  initialInput?: string;
}): React.ReactElement {
  const api = useApi();
  const { fetch: authedFetch } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();

  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const keySeq = useRef(0);
  const initialInputRef = useRef(initialInput);

  const nextKey = useCallback(() => {
    keySeq.current += 1;
    return `tab-${keySeq.current}`;
  }, []);

  const createTab = useCallback(
    async (input?: string): Promise<void> => {
      setCreating(true);
      try {
        // 80×24 is a placeholder — the view resizes to the real geometry
        // the moment its renderer reports it.
        const created = await api.terminals.create(workspaceId, { cols: 80, rows: 24 });
        const tab: Tab = {
          key: nextKey(),
          sessionId: created.id,
          ...(input ? { initialInput: input } : {}),
        };
        setTabs((prev) => [...(prev ?? []), tab]);
        setActiveKey(tab.key);
        haptics.tap();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast({
          message: /INSUFFICIENT_SCOPE|403/.test(message)
            ? 'This device is not allowed to open terminals.'
            : /429|cap \(/.test(message)
              ? 'The server has reached its terminal limit.'
              : `Could not open a terminal: ${message}`,
          tone: 'error',
        });
      } finally {
        setCreating(false);
      }
    },
    [api, nextKey, toast, workspaceId],
  );

  // Seed from the server. `GET /api/workspaces/:id/terminals` answers with
  // `{ terminals: [...] }` (apps/server/src/routes/terminals.ts) — the typed
  // client has no `list`, so this is a direct fetch.
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authedFetch(`/api/workspaces/${workspaceId}/terminals`);
      if (!res.ok) throw new Error(`Could not list terminals (${res.status}).`);
      const body = (await res.json()) as { terminals?: TerminalDescriptor[] };
      const alive = (body.terminals ?? [])
        .filter((d) => d.exitCode === null)
        .slice(0, MAX_TERMINAL_TABS)
        .map<Tab>((d) => ({ key: nextKey(), sessionId: d.id }));
      setTabs(alive);
      setActiveKey(alive[0]?.key ?? null);

      // A deep-linked command always lands in a fresh shell: the user asked
      // to run *this* somewhere clean, not in whatever a previous tab was
      // doing.
      const pending = initialInputRef.current;
      initialInputRef.current = undefined;
      if (pending && alive.length < MAX_TERMINAL_TABS) await createTab(pending);
    } catch (err) {
      setTabs(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [authedFetch, createTab, nextKey, workspaceId]);

  useEffect(() => {
    void load();
    // Once per workspace; the strip owns its state after that.
  }, [workspaceId]);

  const closeTab = useCallback(
    (key: string) => {
      if (!tabs) return;
      const index = tabs.findIndex((t) => t.key === key);
      if (index === -1) return;
      const tab = tabs[index]!;
      // DELETE /api/workspaces/:id/terminals/:sid — idempotent server-side.
      void api.terminals.kill(workspaceId, tab.sessionId).catch(() => undefined);
      forgetTerminal(workspaceId, tab.sessionId);
      const next = tabs.filter((t) => t.key !== key);
      setTabs(next);
      if (activeKey === key) setActiveKey(next[Math.min(index, next.length - 1)]?.key ?? null);
      haptics.warn();
    },
    [activeKey, api, tabs, workspaceId],
  );

  const updateTab = useCallback((key: string, patch: Partial<Tab>) => {
    setTabs((prev) => prev?.map((t) => (t.key === key ? { ...t, ...patch } : t)) ?? prev);
  }, []);

  const atCap = (tabs?.length ?? 0) >= MAX_TERMINAL_TABS;

  const strip = useMemo(
    () =>
      tabs?.map((tab, index) => {
        const active = tab.key === activeKey;
        const label = tab.title?.trim() || `Shell ${index + 1}`;
        return (
          <View key={tab.key} className="flex-row items-center">
            <Chip
              label={tab.exited ? `${label} (exited)` : label}
              active={active}
              maxWidth={160}
              onPress={() => setActiveKey(tab.key)}
              accessibilityLabel={`${label}${active ? ', selected' : ''}`}
              icon={
                <TerminalSquare
                  size={12}
                  color={active ? colors.primary : colors['muted-foreground']}
                />
              }
            />
            {active ? (
              <Touchable
                accessibilityLabel={`Close ${label}`}
                haptic="none"
                onPress={() => closeTab(tab.key)}
                className="ml-0.5 h-7 w-7 items-center justify-center rounded-full"
              >
                <X size={14} color={colors['muted-foreground']} />
              </Touchable>
            ) : null}
          </View>
        );
      }),
    [activeKey, closeTab, colors, tabs],
  );

  if (error) {
    return <ErrorState title="Terminal unavailable" message={error} onRetry={() => void load()} />;
  }
  if (tabs === null) {
    return <LoadingState label="Listing terminals" />;
  }
  if (tabs.length === 0) {
    return (
      <EmptyState
        title="No terminal open"
        message="A shell runs on the machine hosting GeneratorAI, in this workspace's directory."
        icon={<TerminalSquare size={22} color={colors['muted-foreground']} />}
        action={{ label: creating ? 'Opening…' : 'New terminal', onPress: () => void createTab() }}
      />
    );
  }

  return (
    // Padding mode, not translate: the renderer and the key bar must both
    // SHRINK above the keyboard so xterm refits and the bottom rows (the
    // prompt being typed at) stay visible. Neither the chat's Terminal pane
    // nor the full-screen route is otherwise lifted — iOS never resizes the
    // window, and Android edge-to-edge no longer does either.
    <KeyboardSticky mode="padding" className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-row items-center border-b border-border bg-card">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ gap: 6, paddingHorizontal: 8, paddingVertical: 6 }}
          style={{ flexGrow: 1, flexShrink: 1 }}
        >
          {strip}
        </ScrollView>
        <View className="px-1">
          <IconButton
            accessibilityLabel={atCap ? `At most ${MAX_TERMINAL_TABS} terminals` : 'New terminal'}
            compact
            disabled={atCap || creating}
            icon={<Plus size={16} color={colors['muted-foreground']} />}
            onPress={() => void createTab()}
          />
        </View>
      </View>

      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <View key={tab.key} style={{ flex: active ? 1 : 0, display: active ? 'flex' : 'none' }}>
            <TerminalView
              workspaceId={workspaceId}
              sessionId={tab.sessionId}
              active={active}
              {...(tab.initialInput ? { initialInput: tab.initialInput } : {})}
              onTitle={(title) => updateTab(tab.key, { title })}
              onSessionChange={(d) => updateTab(tab.key, { sessionId: d.id, exited: false })}
              onExit={() => updateTab(tab.key, { exited: true })}
            />
          </View>
        );
      })}

      {tabs.length > 0 && activeKey === null ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-xs text-muted-foreground">Pick a shell above.</Text>
        </View>
      ) : null}
    </KeyboardSticky>
  );
}
