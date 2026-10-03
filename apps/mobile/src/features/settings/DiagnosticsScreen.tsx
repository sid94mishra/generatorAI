// Settings › Diagnostics (MSetDiagnostics, MDF-119; `/settings/diagnostics`, header Refresh): "Auto-refreshing every
// 5 s · updated hh:mm:ss"; Server — status (`HEALTH.server` dot + word; uptime, chats and runs in flight), agent
// provider, database, version; This <device> — connection (`HEALTH.connection` + direct / relay), key protection, app
// version; Runtime — telemetry and sandbox; Crash reports — the opt-in reporter (MD-42, M10-06, MD-197): a DSN field and
// "Send crash reports", off by default and disabled until the DSN is valid. Not rendered: the server log / export (MG-18)
// and "up to date" (MG-26).
import React, { useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { HEALTH, type HealthTone } from '@generatorai/shared';

import { useConnectionHealth } from '../../blocks/ConnectionStatus';
import { useSystemInfo } from '../../blocks/StatsCards';
import { useAuth } from '../../services/auth/AuthProvider';
import { describeTransport } from '../../services/auth/describeTransport';
import { dsnHost, isValidDsn } from '../../services/native/crashScrub';
import { setCrashSettings, useCrashSettings } from '../../services/native/crashSettings';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { formatBytes } from '../../ui/lib/format';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { nouns } from '../../ui/platform/nouns';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { keyProtection, uptimeLabel } from './model/deviceView';
import { useHealth, useHealthConfig } from './queries';

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Crash reports (MD-42): opt-in, per device, to a Sentry-compatible server the user runs or chooses. */
function CrashReports(): React.ReactElement {
  const settings = useCrashSettings();
  const [draft, setDraft] = useState(settings.dsn);
  const valid = isValidDsn(draft);
  const host = dsnHost(settings.dsn);
  const commit = (): void => {
    const dsn = draft.trim();
    if (dsn === settings.dsn) return;
    // A cleared or invalid DSN also turns sending off.
    setCrashSettings({ dsn, ...(isValidDsn(dsn) ? {} : { enabled: false }) });
  };
  return (
    <ListSection
      title="Crash reports"
      footer="Off by default. A report holds the error type, its stack and the device model — never messages, prompts, file paths or server addresses — and goes only to the Sentry-compatible server you enter (self-hosted Sentry or GlitchTip)."
    >
      <Field {...(draft.trim() && !valid ? { error: 'Enter a DSN like https://key@sentry.example.com/1' } : {})}>
        <Input label="DSN" kind="url" value={draft} onChangeText={setDraft} onBlur={commit} onSubmitEditing={commit} returnKeyType="done" placeholder="https://key@sentry.example.com/1" testID="diagnostics-crash-dsn" />
      </Field>
      <ListRow
        kind="toggle"
        icon="warning"
        title="Send crash reports"
        subtitle={settings.enabled && host ? `To ${host}` : 'Off'}
        switchValue={settings.enabled && valid}
        onValueChange={(enabled) => setCrashSettings({ dsn: draft.trim(), enabled })}
        disabled={!valid}
        {...(!valid ? { disabledReason: 'Enter a DSN first.' } : {})}
        testID="diagnostics-crash-reports"
      />
    </ListSection>
  );
}

function Mark({ health, label }: { health: HealthTone; label: string }): React.ReactElement {
  return (
    <View className="flex-row items-center gap-1.5">
      <StatusDot health={health} size="sm" />
      <Text role="subhead" tone="fg-3">
        {label}
      </Text>
    </View>
  );
}

export default function DiagnosticsScreen(): React.ReactElement {
  const health = useHealth(5_000);
  const info = useSystemInfo();
  const config = useHealthConfig();
  const { transport, keyBacking } = useAuth();
  const connection = useConnectionHealth();
  const h = health.data;
  const server = h ? (h.status === 'ok' ? HEALTH.server.ok : HEALTH.server.degraded) : null;
  const inFlight = h ? [`${h.activeChats} chat${h.activeChats === 1 ? '' : 's'}`, `${h.activeWorkflowRuns} run${h.activeWorkflowRuns === 1 ? '' : 's'} in flight`].join(', ') : '';
  const key = keyProtection(keyBacking);
  const device = nouns().device;
  const transportWord = describeTransport(transport);
  const updated = health.dataUpdatedAt ? clock.format(new Date(health.dataUpdatedAt)) : null;

  return (
    <SettingsPage
      title="Diagnostics"
      actions={[{ id: 'refresh', icon: 'refresh', label: 'Refresh', onPress: () => void Promise.all([health.refetch(), info.refetch(), config.refetch()]), testID: 'diagnostics-refresh' }]}
      onRefresh={async () => void (await Promise.all([health.refetch(), info.refetch(), config.refetch()]))}
      testID="settings-diagnostics-screen"
    >
      <View className="flex-row items-center gap-1.5 px-4" accessible accessibilityLabel={`${health.isError ? 'Disconnected' : 'Auto-refreshing every 5 seconds'}${updated ? `, updated ${updated}` : ''}`}>
        <StatusDot health={health.isError ? 'err' : 'run'} size="sm" />
        <Text role="footnote" tone="fg-3">
          {health.isError ? "Can't reach the server" : 'Auto-refreshing every 5 s'}
          {updated ? ' · updated' : ''}
        </Text>
        {updated ? (
          <Text role="monoSm" tone="fg-3">
            {updated}
          </Text>
        ) : null}
      </View>

      <ListSection title="Server">
        <ListRow kind="info" icon="activity" title="Status" subtitle={[info.data ? `Up ${uptimeLabel(info.data.uptimeSec)}` : null, inFlight || null].filter(Boolean).join(' · ')} {...(server ? { badge: <Mark health={server.tone} label={server.label} /> } : {})} testID="diagnostics-status" />
        {h ? <ListRow kind="info" icon="model" title="Agent provider" subtitle={h.harness.type} badge={<Mark health={h.harness.healthy ? 'ok' : 'err'} label={h.harness.healthy ? 'Healthy' : 'Unavailable'} />} /> : null}
        {h ? <ListRow kind="info" icon="database" title="Database" subtitle={`SQLite (WAL)${info.data?.database.sizeBytes !== undefined ? ` · ${formatBytes(info.data.database.sizeBytes)}` : ''}`} badge={<Mark health={h.db ? 'ok' : 'err'} label={h.db ? 'OK' : 'Error'} />} /> : null}
        {info.data ? <ListRow kind="value" icon="server" title="Version" subtitle={info.data.serverName} value={info.data.serverVersion} mono copyable /> : null}
      </ListSection>

      <ListSection title={`This ${device}`}>
        <ListRow kind="info" icon="link" title="Connection" subtitle={transportWord.label === 'Relay' ? 'Through the relay' : connection.address ? `Direct · ${connection.address}` : transportWord.label} badge={<Mark health={HEALTH.connection[connection.health].tone} label={HEALTH.connection[connection.health].label} />} testID="diagnostics-connection" />
        <ListRow kind="value" icon="key" title="Key protection" subtitle={key.detail} value={key.value} />
        <ListRow kind="value" icon="device" title="App version" value={Constants.expoConfig?.version ?? 'development'} mono copyable />
      </ListSection>

      <ListSection title="Runtime">
        {h?.otel ? <ListRow kind="value" icon="activity" title="Telemetry" subtitle={h.otel.serviceName ?? 'OpenTelemetry'} value={h.otel.enabled ? 'On' : 'Off'} /> : null}
        {config.data?.sandbox ? (
          <ListRow kind="value" icon="layers" title="Sandbox" subtitle="Set by SANDBOX_ENABLED on the server" value={config.data.sandbox.enabled ? `On · ${config.data.sandbox.provider ?? 'auto'}` : 'Off · host CLI'} />
        ) : (
          <ListRow kind="value" icon="layers" title="Streaming" value="SSE (durable)" />
        )}
      </ListSection>

      <CrashReports />
    </SettingsPage>
  );
}
