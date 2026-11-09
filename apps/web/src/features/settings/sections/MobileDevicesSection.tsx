// ────────────────────────────────────────────────────────────────
// Settings › Mobile devices (docs/devices DV-9): whether the Devices tab and
// the agents' `device_*` tools are available, where the Android SDK is when it
// is not in a standard place, and what this computer has (the same checklist
// as the Devices tab). Server-side: it decides whether agents get the tools.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import type { DeviceToolingStatus } from '@generatorai/shared';
import { useMobileDevicesSettings, useSetMobileDevicesSettings } from '@/hooks/deviceQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';

const PLATFORM_LABEL: Record<DeviceToolingStatus['platform'], string> = {
  android: 'Android emulators and phones',
  ios: 'iOS simulators',
};

function ToolingGroup({ tooling }: { tooling: DeviceToolingStatus }) {
  return (
    <section className="flex flex-col gap-2" aria-label={PLATFORM_LABEL[tooling.platform]}>
      <SectionHeader title={PLATFORM_LABEL[tooling.platform]} level={3} />
      <ul className="flex flex-col gap-1.5">
        {tooling.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-small">
            <Icon concept={c.ok ? 'check' : 'x'} size={14} className={cn('mt-0.5 shrink-0', c.ok ? 'text-ok' : 'text-warn')} />
            <span className="min-w-0">
              <span className="text-fg">{c.label}</span>
              {c.ok && c.detail ? <span className="ml-2 font-mono text-micro text-fg-3">{c.detail}</span> : null}
              {!c.ok && c.hint ? <span className="block text-fg-3">{c.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MobileDevicesSection() {
  const [fresh, setFresh] = useState(false);
  const { data, isLoading, isFetching, refetch } = useMobileDevicesSettings({ fresh });
  const save = useSetMobileDevicesSettings();
  const [error, setError] = useState<string | null>(null);
  const [sdkPath, setSdkPath] = useState('');

  useEffect(() => {
    if (data) setSdkPath(data.androidSdkPath);
  }, [data]);

  const apply = (patch: { enabled?: boolean; androidSdkPath?: string }) => {
    setError(null);
    save.mutate(patch, { onError: (err) => setError(err instanceof Error ? err.message : 'Could not change the setting.') });
  };

  return (
    <SettingsSection
      title="Mobile devices"
      description="Show iOS simulators, Android emulators and Android phones in a chat’s Devices tab, and let agents use them to run and check mobile apps."
    >
      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Checking this computer…
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col">
            <SettingRow
              label="Enable mobile devices"
              hint="When on, chats offer a Devices tab and agents get the device tools. Each chat still asks before the agent uses a phone; simulators and emulators are allowed by default and can be taken over at any time."
              control={
                <Switch
                  aria-label="Enable mobile devices"
                  checked={data.enabled}
                  disabled={save.isPending}
                  onCheckedChange={(next) => apply({ enabled: next })}
                />
              }
            />
            <SettingRow
              label="Android SDK location"
              hint="Leave empty to use ANDROID_HOME or the standard location Android Studio installs to."
              control={
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Android SDK location"
                    value={sdkPath}
                    placeholder="Detected automatically"
                    onChange={(e) => setSdkPath(e.target.value)}
                    className="w-72"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={save.isPending || sdkPath.trim() === data.androidSdkPath}
                    onClick={() => apply({ androidSdkPath: sdkPath.trim() })}
                  >
                    Save
                  </Button>
                </div>
              }
            />
          </div>
          {error ? <Callout tone="err">{error}</Callout> : null}
          <div className="flex items-center justify-between">
            <SectionHeader title="This computer" level={3} />
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              loading={isFetching}
              onClick={() => {
                setFresh(true);
                void refetch();
              }}
            >
              Check again
            </Button>
          </div>
          {data.tooling.map((t) => (
            <ToolingGroup key={t.platform} tooling={t} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
