// ────────────────────────────────────────────────────────────────
// Settings → Storage (workspace retention).
//
// The only scheduled job in the product that deletes the user's files, so the
// UI's job is to make the consequence legible before the toggle goes on: it
// says what gets deleted, what is protected, and when it runs.
//
// State is server-side (persisted next to the database) rather than a client
// preference, because the sweep runs in the server whether or not any browser
// is open.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { Button, Spinner, ToggleSwitch } from '@/components/ui/index.js';
import type { WorkspaceRetentionSettings } from '@/platform/HttpPlatformClient.js';
import { SectionHeader, SettingsCard } from '../shared.js';

export function WorkspaceRetentionSection() {
  const platform = usePlatform();
  const [settings, setSettings] = useState<WorkspaceRetentionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  // Held separately from `settings` so a half-typed number ("3" on the way to
  // "30") never round-trips to the server as a real retention period.
  const [daysDraft, setDaysDraft] = useState('30');

  useEffect(() => {
    let alive = true;
    void platform
      .getWorkspaceRetention()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setDaysDraft(String(s.retentionDays));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [platform]);

  const save = useCallback(
    async (enabled: boolean, retentionDays?: number) => {
      setSaving(true);
      setError(null);
      try {
        const next = await platform.setWorkspaceRetention(enabled, retentionDays);
        setSettings(next);
        setDaysDraft(String(next.retentionDays));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [platform],
  );

  const commitDays = useCallback(() => {
    if (!settings) return;
    const parsed = Number.parseInt(daysDraft, 10);
    // Out of range or not a number: put the saved value back rather than
    // writing something the user did not mean.
    if (!Number.isFinite(parsed) || parsed < settings.minDays || parsed > settings.maxDays) {
      setDaysDraft(String(settings.retentionDays));
      return;
    }
    if (parsed === settings.retentionDays) return;
    void save(settings.enabled, parsed);
  }, [daysDraft, settings, save]);

  const runNow = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await platform.runWorkspaceRetention(settings?.retentionDays);
      setLastRun(
        `Removed ${r.tracked} tracked and ${r.orphans} orphaned workspace${
          r.tracked + r.orphans === 1 ? '' : 's'
        }${r.failed > 0 ? `; ${r.failed} were in use and will be retried` : ''}.`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [platform, settings?.retentionDays]);

  const enabled = settings?.enabled === true;

  return (
    <div>
      <SectionHeader
        title="Storage"
        description="What GeneratorAI keeps on disk, and when it is allowed to clean up."
      />

      <div className="space-y-4">
        <SettingsCard
          title="Delete old workspaces automatically"
          description="Every chat and workflow run gets its own directory. Nothing removes them unless you turn this on."
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" /> Loading…
            </div>
          ) : (
            <div className="space-y-3">
              <ToggleSwitch
                checked={enabled}
                onChange={(next) => void save(next, settings?.retentionDays)}
                disabled={saving}
                label="Run a nightly cleanup"
                description="Runs once a day, after 3am local time. A workspace is deleted only if nothing has touched it for the whole retention period."
              />

              <label className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Keep workspaces for</span>
                <input
                  type="number"
                  min={settings?.minDays ?? 1}
                  max={settings?.maxDays ?? 365}
                  value={daysDraft}
                  disabled={saving}
                  onChange={(e) => setDaysDraft(e.target.value)}
                  onBlur={commitDays}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitDays();
                  }}
                  aria-label="Workspace retention in days"
                  className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <span className="text-muted-foreground">days</span>
              </label>

              <p className="text-xs text-muted-foreground">
                Workspaces with uncommitted changes are archived instead of deleted, and anything
                still in use is left alone and retried the next night.
              </p>

              <div className="flex items-center gap-3 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void runNow()}
                  disabled={saving}
                  loading={saving}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Clean up now
                </Button>
                {lastRun && <span className="text-xs text-muted-foreground">{lastRun}</span>}
              </div>

              {error && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

export default WorkspaceRetentionSection;
