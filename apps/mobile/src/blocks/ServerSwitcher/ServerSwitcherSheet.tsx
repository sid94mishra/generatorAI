// MB-20 ServerSwitcher — the sheet (03 MB-20; MServers; MD-05, MD-85, 06 §6.7): every paired server with its live
// state — the active one from the connection, the others probed when the sheet opens (Retry re-probes) — and
// "Add server…" (the pairing screen in add mode) and "Manage servers" (Settings › Security). A selection sheet: a tap
// switches (the pane and drawer close, the server scope remounts and Home opens) and "Done" closes.
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '../../services/auth/AuthProvider';
import { ListSection } from '../../ui/layout/ListSection';
import { RouteSheet } from '../../ui/native/Sheet';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { Spinner } from '../../ui/primitives/Spinner';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { useConnectionHealth } from '../ConnectionStatus';
import { usePaneStore } from '../WorkspacePane/paneStore';
import { useShellStore } from '../shell/shellStore';
import { activeRow, otherRow, shortAddress, type ProbeStatus, type ServerRowState } from './serverSwitcherModel';

type Href = Parameters<typeof router.push>[0];

function ServerRow({
  name,
  address,
  local,
  current,
  state,
  onPress,
  onRetry,
  onPairAgain,
}: {
  name: string;
  address: string;
  local: boolean;
  current: boolean;
  state: ServerRowState;
  onPress?: () => void;
  onRetry: () => void;
  onPairAgain: () => void;
}): React.ReactElement {
  const label = `${name}, ${state.word}, ${address}${current ? ', current server' : ''}`;
  return (
    <Pressable
      testID={`server-row-${current ? 'current' : name}`}
      onPress={onPress}
      disabled={!onPress}
      frame="none"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: current }}
      className={current ? 'min-h-row-2 flex-row items-center gap-3 bg-selected px-4' : 'min-h-row-2 flex-row items-center gap-3 px-4'}
    >
      <Icon concept={local ? 'computer' : 'server'} size={20} tone={state.tone === 'idle' ? 'fg-3' : 'fg-2'} />
      <View className="min-w-0 flex-1 py-2">
        <Text role="headline" numberOfLines={1}>
          {name}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <StatusDot health={state.tone} size="sm" hollow={state.tone === 'idle'} />
          <Text role="footnote" tone="fg-2" chrome>
            {state.word}
          </Text>
          <Text role="monoSm" tone="fg-3" numberOfLines={1} chrome className="flex-shrink">
            {`· ${address}`}
          </Text>
        </View>
      </View>
      {state.trailing === 'check' ? <Icon concept="check" size={18} tone="fg" /> : null}
      {state.trailing === 'spinner' ? <Spinner size={16} tone="fg-3" label={state.word} /> : null}
      {state.trailing === 'retry' ? <Button label="Retry" variant="ghost" size="sm" onPress={onRetry} accessibilityLabel={`Retry ${name}`} /> : null}
      {state.trailing === 'pair-again' ? <Button label="Pair again" variant="ghost" size="sm" onPress={onPairAgain} accessibilityLabel={`Pair again with ${name}`} /> : null}
    </Pressable>
  );
}

function LinkRow({ icon, title, detail, onPress, testID }: { icon: 'plus' | 'settings'; title: string; detail: string; onPress: () => void; testID: string }): React.ReactElement {
  return (
    <Pressable testID={testID} onPress={onPress} frame="none" accessibilityRole="button" accessibilityLabel={`${title}, ${detail}`} className="min-h-row flex-row items-center gap-3 px-4">
      <Icon concept={icon} size={20} tone="fg-2" />
      <Text role="body" className="flex-1" numberOfLines={1}>
        {title}
      </Text>
      <Text role="footnote" tone="fg-3" numberOfLines={1}>
        {detail}
      </Text>
      <Icon concept="chevron-right" size={16} tone="fg-3" />
    </Pressable>
  );
}

export function ServerSwitcherSheet(): React.ReactElement {
  const { servers, serverId, probeServer, switchServer } = useAuth();
  const { health } = useConnectionHealth();
  const [probes, setProbes] = useState<Record<string, ProbeStatus>>({});
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  }, []);

  const startProbe = useCallback(
    (id: string) => {
      void probeServer(id)
        .then((r) => setProbes((p) => ({ ...p, [id]: r.status })))
        .catch(() => setProbes((p) => ({ ...p, [id]: 'error' })));
    },
    [probeServer],
  );
  const retry = (id: string): void => {
    setProbes((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    startProbe(id);
  };

  useEffect(() => {
    for (const s of servers) if (s.serverId !== serverId) startProbe(s.serverId);
  }, [servers, serverId, startProbe]);

  const switchTo = (id: string): void => {
    if (id === serverId || switching) return;
    setSwitching(id);
    setError(null);
    // 06 §6.7: close the pane and drawer first; the server scope then remounts the tree and opens Home.
    usePaneStore.getState().setOpen(false);
    useShellStore.getState().setDrawerOpen(false);
    switchServer(id).catch((e: unknown) => {
      setSwitching(null);
      setError(e instanceof Error ? e.message : 'Could not switch server');
    });
  };
  const addServer = (): void => router.push({ pathname: '/pair', params: { mode: 'add' } } as never);

  const ordered = [...servers].sort((a, b) => Number(b.serverId === serverId) - Number(a.serverId === serverId));
  return (
    <RouteSheet title="Servers" onDismiss={close} headerAction={{ label: 'Done', onPress: close }} testID="servers-sheet">
      <View className="gap-3 pb-4">
        <ListSection footer={error ?? undefined}>
          {ordered.map((s) => {
            const current = s.serverId === serverId;
            return (
              <ServerRow
                key={s.serverId}
                name={s.label || 'Server'}
                address={shortAddress(s.endpoint)}
                local={s.kind === 'local'}
                current={current}
                state={current ? activeRow(health) : otherRow(probes[s.serverId], switching === s.serverId)}
                {...(current ? {} : { onPress: () => switchTo(s.serverId) })}
                onRetry={() => retry(s.serverId)}
                onPairAgain={addServer}
              />
            );
          })}
        </ListSection>
        <ListSection>
          <LinkRow icon="plus" title="Add server…" detail="Scan or enter code" onPress={addServer} testID="servers-add" />
          <LinkRow icon="settings" title="Manage servers" detail="Security & devices" onPress={() => router.push('/settings/security' as Href)} testID="servers-manage" />
        </ListSection>
        <Text role="footnote" tone="fg-3" className="px-8">
          Each server has its own pairing. Switching reconnects Home, chats and live runs to that server.
        </Text>
      </View>
    </RouteSheet>
  );
}
