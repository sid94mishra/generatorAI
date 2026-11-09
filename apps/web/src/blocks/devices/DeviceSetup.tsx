// ────────────────────────────────────────────────────────────────
// The setup checklist (docs/devices §2, journey 1): what this computer has
// for each platform and the next step for anything missing. Read-only; the
// user installs Xcode / Android Studio themselves (DV-13).
// ────────────────────────────────────────────────────────────────

import type { DeviceToolingStatus } from '@generatorai/shared';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/primitives/Icon/Icon.js';
import { cn } from '@/ui/lib/cn.js';

const PLATFORM_LABEL: Record<DeviceToolingStatus['platform'], string> = {
  android: 'Android emulators and phones',
  ios: 'iOS simulators',
};

export function DeviceSetup({
  tooling,
  onRefresh,
  refreshing,
}: {
  tooling: readonly DeviceToolingStatus[];
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  return (
    <div data-testid="device-setup" className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-ui font-medium text-fg">Set up mobile devices</h3>
          <p className="mt-1 text-small text-fg-2">
            The Devices tab shows the simulators, emulators and phones on this computer. Install the tools below, then
            refresh.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon="refresh" loading={refreshing} onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      {tooling.map((t) => (
        <section key={t.platform} aria-label={PLATFORM_LABEL[t.platform]} className="rounded-card border border-line-soft">
          <header className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <Icon concept="device" size={14} className="text-fg-3" />
            <span className="text-ui text-fg">{PLATFORM_LABEL[t.platform]}</span>
            <span className={cn('ml-auto text-small', t.available ? 'text-ok' : 'text-fg-3')}>{t.available ? 'Ready' : 'Not set up'}</span>
          </header>
          <ul className="divide-y divide-line-soft">
            {t.checks.map((c) => (
              <li key={c.id} className="flex gap-2 px-3 py-2">
                <Icon concept={c.ok ? 'check' : 'x'} size={14} className={cn('mt-0.5 shrink-0', c.ok ? 'text-ok' : 'text-warn')} />
                <div className="min-w-0">
                  <div className="text-ui text-fg">{c.label}</div>
                  {c.ok && c.detail ? <div className="truncate font-mono text-micro text-fg-3" title={c.detail}>{c.detail}</div> : null}
                  {!c.ok && c.hint ? <div className="text-small text-fg-2">{c.hint}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
