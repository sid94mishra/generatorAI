// ────────────────────────────────────────────────────────────────
// F-settings-15 Storage (04 §3.1; content reference MSetStorage). The only
// scheduled job in the product that deletes the user's files, so the UI's
// job is to make the consequence legible before the toggle goes on. Server-
// side (persisted next to the database) rather than a client preference,
// because the sweep runs whether or not any browser is open.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useRunWorkspaceRetention, useSetWorkspaceRetention, useWorkspaceRetention } from '@/hooks/storageQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

export function StorageSection() {
  const { data: settings, isLoading } = useWorkspaceRetention();
  const setRetention = useSetWorkspaceRetention();
  const runNow = useRunWorkspaceRetention();
  const [error, setError] = useState<string | null>(null);
  const [daysDraft, setDaysDraft] = useState<number | null>(null);

  const enabled = settings?.enabled === true;
  const days = daysDraft ?? settings?.retentionDays ?? 30;

  const save = (patch: { enabled: boolean; retentionDays?: number }) => {
    setError(null);
    setRetention.mutate(patch, {
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      onSuccess: () => setDaysDraft(null),
    });
  };

  const commitDays = () => {
    if (!settings || daysDraft == null) return;
    if (daysDraft < settings.minDays || daysDraft > settings.maxDays || daysDraft === settings.retentionDays) {
      setDaysDraft(null);
      return;
    }
    save({ enabled: settings.enabled, retentionDays: daysDraft });
  };

  return (
    <SettingsSection title="Storage" description="What GeneratorAI keeps on disk, and when it is allowed to clean up.">
      {isLoading || !settings ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col">
            <SettingRow
              label="Run a nightly cleanup"
              hint="Runs once a day, after 3am local time. A workspace is deleted only if nothing has touched it for the whole retention period."
              control={
                <Switch
                  aria-label="Run a nightly cleanup"
                  checked={enabled}
                  disabled={setRetention.isPending}
                  onCheckedChange={(next) => save({ enabled: next, retentionDays: settings.retentionDays })}
                />
              }
            />
            <SettingRow
              label="Keep workspaces for"
              hint="Workspaces with uncommitted changes are archived instead of deleted; anything still in use is retried the next night."
              control={
                <div onBlur={commitDays}>
                  <NumberField
                    aria-label="Workspace retention in days"
                    value={days}
                    onValueChange={setDaysDraft}
                    min={settings.minDays}
                    max={settings.maxDays}
                    unit="days"
                    disabled={setRetention.isPending}
                    className="w-32"
                  />
                </div>
              }
            />
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" icon="trash" loading={runNow.isPending} disabled={runNow.isPending} onClick={() => runNow.mutate(settings.retentionDays)}>
              Clean up now
            </Button>
            {runNow.data ? (
              <span className="text-small text-fg-3">
                Removed {runNow.data.tracked} tracked and {runNow.data.orphans} orphaned workspace
                {runNow.data.tracked + runNow.data.orphans === 1 ? '' : 's'}
                {runNow.data.failed > 0 ? `; ${runNow.data.failed} were in use and will be retried` : ''}.
              </span>
            ) : null}
          </div>

          {error ? <Callout tone="err">{error}</Callout> : null}
        </div>
      )}
    </SettingsSection>
  );
}
