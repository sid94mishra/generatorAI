// ────────────────────────────────────────────────────────────────
// F-settings-16 Diagnostics (04 §3.1; content reference MSetDiagnostics).
// Live server health from G-12 system info (absorbs the legacy
// `SystemHealthCard`/`useTicker`), telemetry, sandbox execution and runtime
// facts — read-only. Health is polled live via `useSystemInfo` (30s) and
// `useHealth` (5s, for the still-server-health-only OTel + snapshot fields).
// ────────────────────────────────────────────────────────────────

import { useAttention } from '@/hooks/attentionQueries.js';
import { useHealth, useHealthConfig } from '@/hooks/queries.js';
import { useSystemInfo } from '@/hooks/systemQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Icon } from '@/ui/icons/Icon.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

function SystemHealthGroup() {
  const info = useSystemInfo();
  const data = info.data;
  // The Running list's count (Home), not a second definition.
  const running = useAttention().data?.counts.running;

  const items: KeyValueItem[] = [];
  if (data) {
    items.push({ label: 'Server', value: data.serverName, meta: data.platform });
    items.push({ label: 'Version', value: data.serverVersion, mono: true });
    items.push({ label: 'Uptime', value: formatUptime(data.uptimeSec), mono: true });
    items.push({
      label: 'Agents',
      value: running !== undefined ? `${running} running` : '',
      meta: `max ${data.agents.max}`,
    });
    items.push({
      label: 'Database',
      value: 'SQLite',
      ...(data.database.sizeBytes !== undefined ? { meta: formatBytes(data.database.sizeBytes) } : {}),
    });
  }

  return (
    <section className="flex flex-col gap-2">
      {/* One Refresh for the whole section (the status row above); a second one here duplicated it. */}
      <SectionHeader title="System health" level={3} />
      {!data ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading…
        </div>
      ) : (
        <>
          <KeyValueList items={items} labelWidth={80} />
          {data.disk && data.disk.totalBytes > 0 ? (
            <ProgressBar
              value={data.disk.usedBytes}
              max={data.disk.totalBytes}
              kind="meter"
              label={`Disk · ${formatBytes(data.disk.usedBytes)} / ${formatBytes(data.disk.totalBytes)}`}
            />
          ) : null}
        </>
      )}
      {info.isError ? (
        <Callout tone="err" action={<Button size="sm" onClick={() => void info.refetch()}>Retry</Button>}>
          Could not load system info
        </Callout>
      ) : null}
    </section>
  );
}

export function DiagnosticsSection() {
  const { data: health, isError, isFetching, refetch } = useHealth();
  const info = useSystemInfo();
  const { data: healthConfig, isLoading: sandboxLoading } = useHealthConfig();

  return (
    <SettingsSection title="Diagnostics" description="Live server health, workload, telemetry, and runtime configuration.">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-small text-fg-3">
            <StatusDot tone={isError ? 'err' : 'ok'} size="sm" />
            {isFetching ? 'Refreshing…' : isError ? 'Disconnected' : 'Auto-refreshing'}
          </span>
          <Button
            size="sm"
            icon="refresh"
            loading={isFetching || info.isFetching}
            onClick={() => {
              void refetch();
              void info.refetch();
            }}
          >
            Refresh
          </Button>
        </div>

        <SystemHealthGroup />

        <section className="flex flex-col gap-2">
          <SectionHeader title="Telemetry" level={3} hint="OpenTelemetry export configuration." />
          {!health ? (
            <div className="flex items-center gap-2 text-small text-fg-3">
              <Spinner size={14} /> Loading…
            </div>
          ) : (
            <KeyValueList
              labelWidth={100}
              items={[
                { label: 'OpenTelemetry', value: health.otel.enabled ? 'Enabled' : 'Disabled' },
                ...(health.otel.serviceName ? [{ label: 'Service name', value: health.otel.serviceName, mono: true }] : []),
                ...(health.otel.endpoint ? [{ label: 'Endpoint', value: health.otel.endpoint, mono: true }] : []),
              ]}
            />
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader title="Sandbox execution" level={3} hint="When enabled, code generation runs inside an isolated Docker sandbox." />
          {sandboxLoading ? (
            <div className="flex items-center gap-2 text-small text-fg-3">
              <Spinner size={14} /> Loading…
            </div>
          ) : healthConfig ? (
            <>
              <KeyValueList
                labelWidth={100}
                items={[
                  {
                    label: 'Status',
                    value: (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon concept="shield" size={14} />
                        {healthConfig.sandbox.enabled ? 'Enabled' : 'Disabled (host CLI)'}
                      </span>
                    ),
                  },
                  ...(healthConfig.sandbox.enabled
                    ? [
                        { label: 'Provider', value: healthConfig.sandbox.provider ?? 'auto' },
                        { label: 'Image', value: healthConfig.sandbox.image ?? 'default', mono: true },
                        { label: 'Auto-destroy', value: healthConfig.sandbox.autoDestroy ? 'Yes' : 'No' },
                      ]
                    : []),
                ]}
              />
              <p className="text-micro text-fg-3">
                To toggle sandbox mode, set <span className="font-mono">SANDBOX_ENABLED=true</span> and restart the server.
              </p>
            </>
          ) : (
            <p className="text-small text-fg-3">Sandbox config unavailable.</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader title="Runtime" level={3} />
          <KeyValueList
            labelWidth={100}
            items={[
              { label: 'Database', value: 'SQLite (WAL)' },
              { label: 'Streaming', value: 'SSE (durable)' },
            ]}
          />
        </section>

        {health ? (
          <section className="flex flex-col gap-2">
            <SectionHeader title="Snapshot" level={3} />
            <KeyValueList
              labelWidth={100}
              items={[
                { label: 'Server time', value: new Date(health.timestamp).toLocaleString(), mono: true },
                { label: 'Running sessions', value: String(health.runningChatIds.length) },
              ]}
            />
          </section>
        ) : null}
      </div>
    </SettingsSection>
  );
}
