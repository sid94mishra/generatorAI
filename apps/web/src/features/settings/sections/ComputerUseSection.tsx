// ────────────────────────────────────────────────────────────────
// F-settings-11 Computer use (04 §3.1; content reference MSetComputerUse).
// The one capability in the product that can click anything the user can
// click, so it is OFF until this toggle is turned on. Server-side (persisted
// next to the database) rather than a client preference, because it decides
// whether the agent is handed the `computer_*` tools at all.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { useComputerUseSettings, useSetComputerUseEnabled } from '@/hooks/composerQueries.js';
import { isDesktop, isMacOS, macComputerPermissions, type MacComputerPermissions } from '@/lib/desktop.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import type { ComputerRuntime } from '@/hooks/computerQueries.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const RUNTIME_LABEL: Record<ComputerRuntime['state'], string> = {
  ready: 'Running',
  stopped: 'Installed, not started',
  degraded: 'Running with problems',
  unavailable: 'Not available',
};

function DriverStatusGroup({ runtime }: { runtime: ComputerRuntime }) {
  const failed = (runtime.checks ?? []).filter((c) => c.status === 'fail');
  const items: KeyValueItem[] = [
    { label: 'Status', value: RUNTIME_LABEL[runtime.state], ...(runtime.providerVersion ? { meta: `v${runtime.providerVersion}` } : {}) },
  ];
  if (runtime.host === 'in-process' && runtime.state !== 'unavailable') {
    items.push({ label: 'Host', value: 'In-process — the on-screen agent cursor is not shown' });
  }
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Desktop driver" level={3} />
      <KeyValueList items={items} labelWidth={72} />
      {runtime.detail ? <p className="text-small text-fg-3">{runtime.detail}</p> : null}
      {failed.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {failed.map((c) => (
            <li key={c.name} className="flex items-start gap-2 text-small text-err">
              <Icon concept="warning" size={14} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-mono">{c.name}</span> — {c.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-small text-fg-3">
        Start, restart, and per-window health live in the Computer tab of a chat, where a workspace is in scope.
      </p>
    </section>
  );
}

/**
 * macOS only lists an app under Accessibility and Screen Recording once it has asked, and the desktop driver never
 * asks on its own (U-67) — so this group reads both grants and asks for them from GeneratorAI itself.
 */
function MacPermissionsGroup() {
  const [status, setStatus] = useState<MacComputerPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => void macComputerPermissions('status').then(setStatus), []);
  useEffect(() => {
    refresh();
    // A grant made in System Settings shows up when the person comes back to the window.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  if (!status) return null;
  const granted = (on: boolean) => (on ? 'Granted' : 'Not granted');
  const all = status.accessibility && status.screenRecording;
  return (
    <section className="flex flex-col gap-2" data-testid="computer-mac-permissions">
      <SectionHeader title="macOS permissions" level={3} />
      <KeyValueList
        labelWidth={120}
        items={[
          { label: 'Accessibility', value: granted(status.accessibility) },
          { label: 'Screen Recording', value: granted(status.screenRecording) },
        ]}
      />
      {all ? null : (
        <>
          <p className="text-small text-fg-3">
            Grant access adds GeneratorAI to both lists in System Settings → Privacy &amp; Security and asks macOS for each. Turn GeneratorAI on in both,
            then quit and reopen GeneratorAI.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              icon="shield"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void macComputerPermissions('request').then((next) => {
                  setStatus(next);
                  setBusy(false);
                });
              }}
            >
              Grant access
            </Button>
            <Button size="sm" variant="ghost" icon="external-link" onClick={() => void macComputerPermissions('openSettings')}>
              Open Screen Recording settings
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function ComputerUseSection() {
  const { data, isLoading } = useComputerUseSettings();
  const setEnabled = useSetComputerUseEnabled();
  const [error, setError] = useState<string | null>(null);

  const enabled = data?.enabled === true;
  const allowSynthetic = data?.allowSynthetic === true;
  const killSwitch = data?.killSwitch === true;

  const save = (next: { enabled: boolean; allowSynthetic?: boolean }) => {
    setError(null);
    setEnabled.mutate(next, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not change the setting.'),
    });
  };

  return (
    <SettingsSection
      title="Computer use"
      description="Let the agent operate native desktop applications on this machine — launch apps, read windows, click controls, and fill fields."
    >
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <div className="flex items-center gap-2 text-small text-fg-3">
            <Spinner size={14} /> Checking availability…
          </div>
        ) : (
          <div className="flex flex-col">
            <SettingRow
              label="Enable Computer use"
              hint={
                killSwitch
                  ? 'Hard-disabled by GENERATORAI_COMPUTER_USE in this server’s environment. The toggle cannot override it.'
                  : 'When on, the computer_use skill appears in the chat “/” menu and the agent is given the computer_* tools.'
              }
              control={
                <Switch
                  aria-label="Enable Computer use"
                  checked={enabled}
                  disabled={setEnabled.isPending || killSwitch}
                  onCheckedChange={(next) => save({ enabled: next })}
                />
              }
            />
            <SettingRow
              label="Allow actions that take over the screen"
              hint="Keystrokes, hotkeys, scrolling and dragging are delivered as real input, so the target window must be focused — some apps ignore anything else. Off keeps every action in the background: the agent reads windows and clicks controls without touching your cursor, and refuses steps that would need focus."
              control={
                <Switch
                  aria-label="Allow actions that take over the screen"
                  checked={allowSynthetic}
                  disabled={setEnabled.isPending || killSwitch || !enabled}
                  onCheckedChange={(next) => save({ enabled, allowSynthetic: next })}
                />
              }
            />
          </div>
        )}

        {error ? <Callout tone="err">{error}</Callout> : null}

        {enabled && isDesktop && isMacOS ? <MacPermissionsGroup /> : null}

        {enabled && data?.runtime ? <DriverStatusGroup runtime={data.runtime} /> : null}

        <section className="flex flex-col gap-2">
          <SectionHeader title="How it works" level={3} />
          <ol className="flex flex-col gap-2.5 text-small text-fg-3">
            <li className="flex gap-2.5">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-selected text-micro font-medium text-fg">1</span>
              <span>Turn the toggle on. The agent receives the sixteen `computer_*` tools on its next turn — existing chats included.</span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-selected text-micro font-medium text-fg">2</span>
              <span>
                In a chat, type <span className="font-mono">/computer-use</span> and describe the desktop task. The skill is registered with the
                model, which loads its instructions on demand — your message stays just your message.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-selected text-micro font-medium text-fg">3</span>
              <span>Open the Computer tab in the chat’s side pane to watch every window the agent reads and every action it takes.</span>
            </li>
          </ol>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader title="What stays blocked, always" level={3} />
          <ul className="flex flex-col gap-1.5 text-small text-fg-3">
            <li className="flex gap-2">
              <Icon concept="computer" size={14} className="mt-0.5 shrink-0" />
              Password managers and credential prompts are excluded from every app listing and can never be driven.
            </li>
            <li className="flex gap-2">
              <Icon concept="computer" size={14} className="mt-0.5 shrink-0" />
              Fields the accessibility layer reports as secure are never read or filled.
            </li>
            <li className="flex gap-2">
              <Icon concept="computer" size={14} className="mt-0.5 shrink-0" />
              Text on screen is treated as untrusted data, never as instructions.
            </li>
            <li className="flex gap-2">
              <Icon concept="computer" size={14} className="mt-0.5 shrink-0" />
              Every action is recorded to the Computer use audit log with the app it targeted.
            </li>
          </ul>
        </section>
      </div>
    </SettingsSection>
  );
}
