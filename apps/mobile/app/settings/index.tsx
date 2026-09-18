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
  Puzzle,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { describeTransport } from '../../src/auth/describeTransport';
import { Badge, type Tone } from '../../src/components/ui/primitives';
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

  const connection = describeTransport(transport);

  const readyProviders = providers.data?.providers.filter((p) => p.ready).length ?? 0;

  return (
    <Screen title="Settings" back>
      {/* Which machine this phone is talking to, and how — the first thing
          to check when anything below looks wrong. */}
      <ListGroup>
        <ListRow
          title={state.status === 'authenticated' ? 'Connected to GeneratorAI' : 'Not paired'}
          subtitle={connection.detail}
          icon={<Server size={18} color={colors['muted-foreground']} />}
          trailing={<Badge label={connection.label} tone={connection.tone as Tone} />}
          onPress={() => router.push('/settings/diagnostics')}
          accessibilityLabel={`Connection, ${connection.label}`}
        />
      </ListGroup>

      <SectionHeader title="App" />
      <ListGroup>
        <ListRow
          title="Appearance"
          subtitle="Theme and accent colour"
          icon={<Palette size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/appearance')}
        />
        <ListRow
          title="Notifications"
          subtitle="What this device alerts you about"
          icon={<Bell size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/notifications')}
        />
        <ListRow
          title="Accessibility"
          subtitle="Motion, haptics, text size and app lock"
          icon={<Accessibility size={18} color={colors['muted-foreground']} />}
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
          icon={<Cpu size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/providers')}
          trailing={
            providers.data && readyProviders === 0 ? <Badge label="None" tone="danger" /> : undefined
          }
        />
        <ListRow
          title="Capabilities"
          subtitle="Skills, MCP servers and extensions"
          icon={<Sparkles size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/capabilities')}
        />
        <ListRow
          title="Extensions"
          subtitle="Installed on your machine — on, off, or failed to load"
          icon={<Puzzle size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/extensions')}
        />
      </ListGroup>

      <SectionHeader title="Integrations" />
      <ListGroup>
        <ListRow
          title="Source control"
          subtitle="How the agent reaches your repositories"
          icon={<GitBranch size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/source-control')}
        />
      </ListGroup>

      <SectionHeader title="System" />
      <ListGroup>
        <ListRow
          title="Security and devices"
          subtitle={
            state.status === 'authenticated'
              ? `Paired devices and keys · ${state.scopes.length} granted`
              : 'Not paired'
          }
          icon={<ShieldCheck size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/security')}
        />
        {/* Was "Permissions" under Integrations, beside a Security row that
            also counted "permissions" — two names for one idea. It is the
            per-feature view of the same grants, so it sits next to them. */}
        <ListRow
          title="Phone access"
          subtitle="Terminal, browser, files — what this phone may drive"
          icon={<TerminalSquare size={18} color={colors['muted-foreground']} />}
          onPress={() => router.push('/settings/tools')}
        />
        <ListRow
          title="Diagnostics"
          subtitle={
            health.data
              ? `${health.data.status} · ${describeTransport(transport).label.toLowerCase()}`
              : 'Checking…'
          }
          icon={<Activity size={18} color={colors['muted-foreground']} />}
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

      <View className="pt-4">
        <Text className="text-xs leading-relaxed text-muted-foreground">
          Settings that change your machine — provider credentials, sandbox configuration, workflow
          definitions — are edited on the desktop or web app. This device can read them and change
          what it is itself permitted to do.
        </Text>
      </View>
    </Screen>
  );
}
