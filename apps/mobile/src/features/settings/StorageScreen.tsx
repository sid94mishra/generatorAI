// Settings › Storage (MSetStorage, MDF-119; `/settings/storage`): the server disk (used of total, a neutral bar, when
// the server could measure it), Automatic cleanup — Nightly cleanup and Keep for N days (the server's bounds) — and
// one verb, "Clean up" (confirmed, step-up), whose result shows inline ("Removed 3 workspaces"), not as a toast.
// The per-project breakdown, orphaned size and a dry-run count are not rendered until MG-25. Writes need
// `admin:settings`.
import React, { useState } from 'react';
import { View } from 'react-native';

import { useSystemInfo } from '../../blocks/StatsCards';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { formatBytes } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { ProgressBar } from '../../ui/primitives/ProgressBar';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { SettingsPage } from './components/SettingsPage';
import { cleanupSummary } from './model/storageModel';
import { useRetention, useRetentionWrites } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

export default function StorageScreen(): React.ReactElement {
  const retention = useRetention();
  const writes = useRetentionWrites();
  const info = useSystemInfo();
  const access = useScopeAccess('admin:settings', 'Change workspace cleanup from this device');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const r = retention.data;
  const disk = info.data?.disk;

  const set = (patch: { enabled: boolean; retentionDays?: number }, reason: string): void => void adminWrite(reason, () => writes.set(patch));
  const clean = (): void => {
    if (!r) return;
    void confirm({
      title: 'Clean up workspaces now?',
      message: `Deletes workspaces untouched for ${r.retentionDays} days. Uncommitted changes are archived instead; anything in use is skipped.`,
      confirmLabel: 'Clean up',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setRunning(true);
      setResult(null);
      void adminWrite('Clean up old workspaces', () => writes.run(r.retentionDays))
        .then((out) => {
          if (!out) return;
          haptic('success');
          setResult(cleanupSummary(out));
        })
        .finally(() => setRunning(false));
    });
  };

  return (
    <SettingsPage
      title="Storage"
      intro="Every chat and run gets its own workspace on the server. Cleanup removes the ones nothing has touched for a while."
      onRefresh={async () => void (await Promise.all([retention.refetch(), info.refetch()]))}
      testID="settings-storage-screen"
    >
      {disk && disk.totalBytes > 0 ? (
        <View className="px-4">
          <ProgressBar value={disk.usedBytes / disk.totalBytes} label="Server disk" valueText={`${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)}`} testID="storage-disk" />
        </View>
      ) : null}
      {retention.isLoading ? <Skeleton preset="list" count={2} /> : null}
      {retention.isError && !r ? <ListSection><ListRow kind="requires-admin" icon="database" title="Workspace cleanup" onPress={access.request} testID="storage-requires-admin" /></ListSection> : null}
      {r ? (
        <ListSection title="Automatic cleanup" footer="Runs once a night, after 3 am server time. Uncommitted changes are archived, not deleted.">
          <ListRow kind="toggle" icon="clock" title="Nightly cleanup" switchValue={r.enabled} onValueChange={(v) => set({ enabled: v, retentionDays: r.retentionDays }, v ? 'Turn nightly cleanup on' : 'Turn nightly cleanup off')} disabled={!access.granted} testID="storage-nightly" />
          <ListRow
            kind="stepper"
            icon="calendar"
            title="Keep for"
            subtitle={`${r.retentionDays} days untouched`}
            stepper={{ value: r.retentionDays, min: r.minDays, max: r.maxDays, onValueChange: (d) => set({ enabled: r.enabled, retentionDays: d }, 'Change how long workspaces are kept'), disabled: !access.granted, testID: 'storage-days' }}
          />
        </ListSection>
      ) : null}
      {r && !access.granted ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="database" title="Change cleanup" onPress={access.request} testID="storage-requires-admin" />
        </ListSection>
      ) : null}
      {r && access.granted ? (
        <View className="gap-3 px-4">
          <Button label="Clean up now" icon="trash" variant="secondary" size="lg" fullWidth loading={running} onPress={clean} testID="storage-clean" />
          {result ? <Callout tone="ok" title={result} testID="storage-result" /> : null}
        </View>
      ) : null}
    </SettingsPage>
  );
}
