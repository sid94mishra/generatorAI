// ────────────────────────────────────────────────────────────────
// Settings › Diagnostics.
//
// Everything needed to answer "why is this app behaving oddly" without
// plugging the phone into anything: server health, which provider is live,
// how this device is currently connected, and how its key is protected.
//
// The transport row matters more here than on any other client — a phone
// silently failing over from LAN to relay explains a whole class of "it got
// slow" reports.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  Activity,
  Cpu,
  Database,
  KeyRound,
  Radio,
  Timer,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { describeKeyBacking, describeTransport } from '../../src/auth/describeTransport';
import { formatDuration } from '../../src/components/runs/formatTime';
import { Badge, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function DiagnosticsScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();
  const { transport, keyBacking, state, reconnect } = useAuth();

  const connection = describeTransport(transport);
  const key = describeKeyBacking(keyBacking);

  const health = useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => api.health(),
    refetchInterval: 10_000,
  });

  return (
    <Screen
      title="Diagnostics"
      back
      onRefresh={() => void health.refetch()}
      refreshing={health.isFetching}
    >
      <SectionHeader title="Server" />
      {health.isLoading ? (
        <SkeletonList rows={4} />
      ) : health.isError ? (
        <ErrorState message="Could not reach the server." onRetry={() => void health.refetch()} />
      ) : (
        <ListGroup>
          <ListRow
            title="Status"
            subtitle={health.data?.timestamp}
            icon={<Activity size={18} color={colors['muted-foreground']} />}
            chevron={false}
            trailing={
              <Badge
                label={health.data?.status ?? 'unknown'}
                tone={health.data?.status === 'ok' ? 'success' : 'warning'}
              />
            }
          />
          <ListRow
            title="Agent provider"
            subtitle={health.data?.harness.type}
            icon={<Cpu size={18} color={colors['muted-foreground']} />}
            chevron={false}
            trailing={
              <Badge
                label={health.data?.harness.healthy ? 'Healthy' : 'Down'}
                tone={health.data?.harness.healthy ? 'success' : 'danger'}
              />
            }
          />
          <ListRow
            title="Database"
            icon={<Database size={18} color={colors['muted-foreground']} />}
            chevron={false}
            trailing={
              <Badge label={health.data?.db ? 'OK' : 'Error'} tone={health.data?.db ? 'success' : 'danger'} />
            }
          />
          <ListRow
            title="Uptime"
            subtitle={formatDuration((health.data?.uptime ?? 0) * 1000)}
            icon={<Timer size={18} color={colors['muted-foreground']} />}
            chevron={false}
          />
          <ListRow
            title="In flight"
            subtitle={`${health.data?.activeChats ?? 0} chats · ${health.data?.activeWorkflowRuns ?? 0} runs`}
            icon={<Activity size={18} color={colors['muted-foreground']} />}
            chevron={false}
          />
        </ListGroup>
      )}

      <SectionHeader title="This device" />
      <ListGroup>
        <ListRow
          title="Connection"
          subtitle={connection.detail}
          icon={<Radio size={18} color={colors['muted-foreground']} />}
          onPress={reconnect}
          chevron={false}
          trailing={<Badge label={connection.label} tone={connection.tone} />}
        />
        <ListRow
          title="Key protection"
          subtitle={key.detail}
          icon={<KeyRound size={18} color={colors['muted-foreground']} />}
          chevron={false}
          trailing={
            <Badge
              label={key.hardware ? 'Hardware' : 'Software'}
              tone={key.hardware ? 'success' : 'warning'}
            />
          }
        />
        <ListRow
          title="App version"
          subtitle={`${Constants.expoConfig?.version ?? 'dev'}${
            state.status === 'authenticated' ? ` · device ${state.deviceId.slice(0, 8)}` : ''
          }`}
          icon={<Cpu size={18} color={colors['muted-foreground']} />}
          chevron={false}
        />
      </ListGroup>

      <Text className="pt-2 text-xs leading-relaxed text-muted-foreground">
        Tap Connection to force a re-probe of the host. That is worth doing after changing networks —
        the app pins a host identity, so it will not silently attach to a different machine.
      </Text>
    </Screen>
  );
}
