// Settings › Computer use (MSetComputerUse, MDF-118; `/settings/computer-use`): "Enable Computer Use" (a server
// setting — `admin:settings` + a step-up on every change), "Take over the screen" shown read-only (a phone never
// turns on real keystrokes, MD-37), the kill switch as a Callout, the desktop driver (`HEALTH.computerRuntime` dot +
// word, version, in-process note, failed checks) and what stays blocked. App grants are per workspace (a chat's
// Computer tab); there is no server-wide list, so none are drawn here (MD-27).
import React from 'react';
import { View } from 'react-native';
import { HEALTH } from '@generatorai/shared';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { haptic } from '../../ui/platform/haptics';
import { Callout } from '../../ui/primitives/Callout';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { useComputerUseStatus, useSetComputerUse } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

type RuntimeState = keyof typeof HEALTH.computerRuntime;

interface RuntimeView {
  state?: string;
  providerVersion?: string;
  host?: string;
  detail?: string;
  checks?: Array<{ name: string; status: string; message?: string }>;
}

const RUNTIME_WORD: Record<RuntimeState, string> = { ready: 'Running', stopped: 'Installed, not started', degraded: 'Running with problems', unavailable: 'Not available' };

const BLOCKED = [
  'Password managers and credential prompts are never listed or driven.',
  'Fields the accessibility layer reports as secure are never read or filled.',
  'Text on screen is treated as data, never as instructions.',
  'Every action is written to the Computer use audit log.',
];

export default function ComputerUseScreen(): React.ReactElement {
  const status = useComputerUseStatus();
  const set = useSetComputerUse();
  const access = useScopeAccess('admin:settings', 'Turn Computer use on or off from this device');
  const data = status.data;
  const runtime = (data?.runtime ?? null) as RuntimeView | null;
  const state = (runtime?.state && runtime.state in HEALTH.computerRuntime ? runtime.state : null) as RuntimeState | null;
  const failed = (runtime?.checks ?? []).filter((c) => c.status === 'fail');

  const toggle = (enabled: boolean): void =>
    void adminWrite(enabled ? 'Let agents use this computer' : 'Turn Computer use off', () => set.mutateAsync({ enabled })).then((r) => r && haptic('success'));

  return (
    <SettingsPage
      title="Computer use"
      intro="Lets agents operate native apps on the server's computer: launch them, read windows, click controls and fill fields."
      onRefresh={async () => void (await status.refetch())}
      state={status.isError && !data ? { kind: 'error', error: status.error, onRetry: () => void status.refetch(), title: "Couldn't load Computer use" } : { kind: 'ready' }}
      testID="settings-computer-use-screen"
    >
      {status.isLoading ? <Skeleton preset="list" count={3} /> : null}
      {data?.killSwitch ? (
        <View className="px-4">
          <Callout tone="warn" title="Turned off on the server" body="GENERATORAI_COMPUTER_USE disables it in this server's environment; the switch cannot override that." />
        </View>
      ) : null}
      {data ? (
        <ListSection title="Desktop automation" footer="Off by default: the only capability that acts on the real screen. Without take-over the agent works in the background.">
          {access.granted ? (
            <ListRow kind="toggle" icon="computer" title="Enable Computer use" subtitle="Adds the computer_* tools" switchValue={data.enabled} onValueChange={toggle} disabled={data.killSwitch === true || set.isPending} testID="computer-use-enable" />
          ) : (
            <>
              <ListRow kind="value" icon="computer" title="Computer use" value={data.enabled ? 'On' : 'Off'} />
              <ListRow kind="requires-admin" icon="lock" title="Turn it on or off" onPress={access.request} testID="computer-use-requires-admin" />
            </>
          )}
          <ListRow kind="value" icon="pointer" title="Take over the screen" subtitle="Real keystrokes, scroll and drag · set on the desktop" value={data.allowSynthetic ? 'On' : 'Off'} testID="computer-use-takeover" />
        </ListSection>
      ) : null}

      {data?.enabled && runtime ? (
        <ListSection title="Desktop driver" footer="Start and restart it from a chat's Computer tab.">
          <ListRow
            kind="info"
            icon="activity"
            title={state ? RUNTIME_WORD[state] : 'Unknown'}
            subtitle={runtime.host === 'in-process' ? 'In the server process · no agent cursor' : (runtime.detail ?? '')}
            badge={
              <View className="flex-row items-center gap-1.5">
                {runtime.providerVersion ? (
                  <Text role="monoSm" tone="fg-3">
                    v{runtime.providerVersion}
                  </Text>
                ) : null}
                {state ? <StatusDot health={HEALTH.computerRuntime[state].tone} size="sm" label={HEALTH.computerRuntime[state].label} /> : null}
              </View>
            }
            testID="computer-use-runtime"
          />
          {failed.map((c) => (
            <ListRow key={c.name} kind="info" icon="warning" title={c.name} subtitle={c.message ?? 'Failed'} />
          ))}
        </ListSection>
      ) : null}

      <ListSection title="Always blocked">
        {BLOCKED.map((line) => (
          <ListRow key={line} kind="info" icon="shield" title={line} />
        ))}
      </ListSection>
    </SettingsPage>
  );
}
