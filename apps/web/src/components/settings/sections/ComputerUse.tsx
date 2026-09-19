// ────────────────────────────────────────────────────────────────
// Settings → Computer Use.
//
// The one capability in the product that can click anything the user can
// click, so it is OFF until this toggle is turned on. The state is server-side
// (persisted next to the database) rather than a client preference, because it
// decides whether the agent is handed the `computer_*` tools at all.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MonitorCog } from 'lucide-react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { useComputerUseSettings } from '@/hooks/composerQueries.js';
import { Spinner, ToggleSwitch } from '@/components/ui/index.js';
import type { ComputerRuntime } from '@/platform/HttpPlatformClient.js';
import { SectionHeader, SettingsCard } from '../shared.js';

const RUNTIME_LABEL: Record<ComputerRuntime['state'], string> = {
  ready: 'Running',
  stopped: 'Installed, not started',
  degraded: 'Running with problems',
  unavailable: 'Not available',
};

const RUNTIME_TONE: Record<ComputerRuntime['state'], string> = {
  ready: 'text-success',
  stopped: 'text-muted-foreground',
  degraded: 'text-warning',
  unavailable: 'text-destructive',
};

/**
 * Settings has no workspace, so this reports whether a driver exists at all.
 * Starting one needs a workspace and lives in the chat's Computer panel.
 */
function DriverStatusCard({ runtime }: { runtime: ComputerRuntime }) {
  const failed = (runtime.checks ?? []).filter((c) => c.status === 'fail');
  return (
    <SettingsCard title="Desktop driver">
      <div className="space-y-2 text-xs">
        <p className={`font-medium ${RUNTIME_TONE[runtime.state]}`}>
          {RUNTIME_LABEL[runtime.state]}
          {runtime.providerVersion ? ` · v${runtime.providerVersion}` : ''}
        </p>
        {runtime.detail && <p className="text-muted-foreground">{runtime.detail}</p>}
        {runtime.host === 'in-process' && runtime.state !== 'unavailable' && (
          <p className="text-muted-foreground">
            Running inside the server process. Actions work; the on-screen agent cursor does not,
            because that overlay belongs to a separate driver process.
          </p>
        )}
        {failed.length > 0 && (
          <ul className="space-y-1">
            {failed.map((c) => (
              <li key={c.name} className="flex gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-mono">{c.name}</span> — {c.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground">
          Start, restart, and per-window health live in the{' '}
          <strong className="font-medium text-foreground">Computer</strong> tab of a chat, where a
          workspace is in scope.
        </p>
      </div>
    </SettingsCard>
  );
}

export function ComputerUseSection() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  const { data, isLoading } = useComputerUseSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (next: { enabled: boolean; allowSynthetic?: boolean }) => {
      setSaving(true);
      setError(null);
      void platform
        .setComputerUseEnabled(next.enabled, next.allowSynthetic)
        .then((result) => {
          queryClient.setQueryData(['computer-use-settings'], result);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Could not change the setting.');
        })
        .finally(() => setSaving(false));
    },
    [platform, queryClient],
  );

  const enabled = data?.enabled === true;
  const allowSynthetic = data?.allowSynthetic === true;
  const killSwitch = data?.killSwitch === true;

  return (
    <div>
      <SectionHeader
        title="Computer Use"
        description="Let the agent operate native desktop applications on this machine — launch apps, read windows, click controls, and fill fields."
      />

      <div className="space-y-4">
        <SettingsCard
          title="Desktop automation"
          description="Off by default. This is the only capability that can reach outside the app and act on your real screen."
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" /> Checking availability…
            </div>
          ) : (
            <div className="space-y-3">
              <ToggleSwitch
                checked={enabled}
                onChange={(next) => save({ enabled: next })}
                disabled={saving || killSwitch}
                label="Enable Computer Use"
                description={
                  killSwitch
                    ? 'Hard-disabled by GENERATORAI_COMPUTER_USE in this server’s environment. The toggle cannot override it.'
                    : 'When on, the computer_use skill appears in the chat “/” menu and the agent is given the computer_* tools.'
                }
              />
              <ToggleSwitch
                checked={allowSynthetic}
                onChange={(next) => save({ enabled, allowSynthetic: next })}
                disabled={saving || killSwitch || !enabled}
                label="Allow actions that take over the screen"
                description="Keystrokes, hotkeys, scrolling and dragging are delivered as real input, so the target window must be focused — some apps (Chrome among them) ignore anything else. Off keeps every action in the background: the agent reads windows and clicks controls without touching your cursor, and refuses steps that would need focus."
              />
              {error && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}
        </SettingsCard>

        {enabled && data?.runtime && <DriverStatusCard runtime={data.runtime} />}

        <SettingsCard title="How it works">
          <ol className="space-y-2.5 text-xs text-muted-foreground">
            <li className="flex gap-2.5">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-subtle text-[10px] font-medium text-foreground">1</span>
              <span>
                Turn the toggle on. The agent receives the sixteen <code className="font-mono">computer_*</code> tools
                on its next turn — existing chats included.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-subtle text-[10px] font-medium text-foreground">2</span>
              <span>
                In a chat, type <code className="font-mono">/computer-use</code> and describe the desktop task. The
                skill is registered with the model, which loads its instructions on demand — your message stays
                just your message.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-subtle text-[10px] font-medium text-foreground">3</span>
              <span>
                Open the <strong className="font-medium text-foreground">Computer</strong> tab in the chat’s side
                pane to watch every window the agent reads and every action it takes.
              </span>
            </li>
          </ol>
        </SettingsCard>

        <SettingsCard title="What stays blocked, always">
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Password managers and credential prompts are excluded from every app listing and can never be driven.
            </li>
            <li className="flex gap-2">
              <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Fields the accessibility layer reports as secure are never read or filled.
            </li>
            <li className="flex gap-2">
              <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Text on screen is treated as untrusted data, never as instructions.
            </li>
            <li className="flex gap-2">
              <MonitorCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Every action is recorded to the Computer Use audit log with the app it targeted.
            </li>
          </ul>
        </SettingsCard>
      </div>
    </div>
  );
}
