// ────────────────────────────────────────────────────────────────
// Settings hub.
//
// Mirrors the web settings modal's grouping (App · Agents · Integrations ·
// System) so someone who knows one knows the other. The web version is a
// two-column modal with a section rail; on a phone that becomes a grouped
// list that pushes each section, which is the standard iOS/Android shape and
// needs no explanation.
//
// Sections that are read-only here say so on their own screen rather than
// being hidden, so nobody has to guess whether the app is missing a feature
// or the device is missing a permission.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Accessibility,
  Activity,
  Bell,
  Blocks,
  Cpu,
  GitBranch,
  Palette,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { describeTransport } from '../../src/auth/describeTransport';
import { Badge } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { SectionHeader } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function SettingsScreen(): React.ReactElement {
  const { colors } = useTheme();
  const api = useApi();
  const { state, transport } = useAuth();

  const health = useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => api.health(),
    refetchInterval: 15_000,
  });

  const providers = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.harness.providers(),
  });

  const readyProviders = providers.data?.providers.filter((p) => p.ready).length ?? 0;

  return (
    <Screen title="Settings" back>
      <SectionHeader title="App" />
      <ListGroup>
        <ListRow
          title="Appearance"
          subtitle="Theme and accent colour"
          icon={<Palette size={18} color={colors.primary} />}
          onPress={() => router.push('/settings/appearance')}
        />
        <ListRow
          title="Notifications"
          subtitle="What this device alerts you about"
          icon={<Bell size={18} color={colors.info} />}
          onPress={() => router.push('/settings/notifications')}
        />
        <ListRow
          title="Accessibility"
          subtitle="Motion, haptics, text size and app lock"
          icon={<Accessibility size={18} color={colors.success} />}
          onPress={() => router.push('/settings/accessibility')}
        />
      </ListGroup>

      <SectionHeader title="Agents" />
      <ListGroup>
        <ListRow
          title="Model providers"
          subtitle={
            providers.isLoading
              ? 'Checking…'
              : `${readyProviders} of ${providers.data?.providers.length ?? 0} ready`
          }
          icon={<Cpu size={18} color={colors.primary} />}
          onPress={() => router.push('/settings/providers')}
          trailing={
            providers.data && readyProviders === 0 ? <Badge label="None" tone="danger" /> : undefined
          }
        />
        <ListRow
          title="Capabilities"
          subtitle="Skills, MCP servers and extensions"
          icon={<Sparkles size={18} color={colors.info} />}
          onPress={() => router.push('/settings/capabilities')}
        />
      </ListGroup>

      <SectionHeader title="Integrations" />
      <ListGroup>
        <ListRow
          title="Source control"
          subtitle="How the agent reaches your repositories"
          icon={<GitBranch size={18} color={colors.warning} />}
          onPress={() => router.push('/settings/source-control')}
        />
        <ListRow
          title="Permissions"
          subtitle="Terminal, browser and what else this phone may drive"
          icon={<TerminalSquare size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/tools')}
        />
      </ListGroup>

      <SectionHeader title="System" />
      <ListGroup>
        <ListRow
          title="Security and devices"
          subtitle={
            state.status === 'authenticated'
              ? `${state.scopes.length} permissions granted`
              : 'Not paired'
          }
          icon={<ShieldCheck size={18} color={colors.success} />}
          onPress={() => router.push('/settings/security')}
        />
        <ListRow
          title="Diagnostics"
          subtitle={
            health.data
              ? `${health.data.status} · ${describeTransport(transport).label.toLowerCase()}`
              : 'Checking…'
          }
          icon={<Activity size={18} color={colors.info} />}
          onPress={() => router.push('/settings/diagnostics')}
          trailing={
            health.data && health.data.status !== 'ok' ? (
              <Badge label="Degraded" tone="warning" />
            ) : undefined
          }
        />
        <ListRow
          title="About"
          subtitle="Version and what this app can do"
          icon={<Blocks size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/about')}
        />
      </ListGroup>

      <View className="px-1 pt-4">
        <Text className="text-xs leading-relaxed text-muted-foreground">
          Settings that change your machine — provider credentials, sandbox configuration, workflow
          definitions — are edited on the desktop or web app. This device can read them and change
          what it is itself permitted to do.
        </Text>
      </View>
    </Screen>
  );
}
