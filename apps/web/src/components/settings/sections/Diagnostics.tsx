// ────────────────────────────────────────────────────────────────
// Settings → Diagnostics section.
// The single "System" tab: live server health (connection heartbeat +
// every readout), telemetry (OpenTelemetry), sandbox execution config,
// runtime facts, and the raw snapshot. Health is polled live via
// useHealth (5s); sandbox/runtime facts are env-configured (read-only).
// ────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import { Radio, RefreshCw, Shield, Box, Server } from 'lucide-react';
import { useHealth } from '@/hooks/queries.js';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { Button, Spinner } from '@/components/ui/index.js';
import { SystemHealthCard } from '@/components/dashboard/SystemHealthCard.js';
import { useTicker } from '@/components/dashboard/useTicker.js';
import { SectionHeader, SettingsCard, InfoRow, StatusPip } from '../shared.js';

export function DiagnosticsSection() {
  const platform = usePlatform();
  const { data: health, isError, isFetching, dataUpdatedAt, refetch } = useHealth();
  const now = useTicker(true, 1000);

  const [sandbox, setSandbox] = useState<{ enabled?: boolean; provider?: string; image?: string; autoDestroy?: boolean } | null>(null);
  const [sandboxLoading, setSandboxLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await fetch(`${platform.baseUrl}/api/health/config`);
        if (!cancelled && c.ok) setSandbox((await c.json()).sandbox ?? null);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSandboxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [platform.baseUrl]);

  return (
    <div>
      <SectionHeader
        title="Diagnostics"
        description="Live server health, workload, telemetry, and runtime configuration."
      />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio className="h-3.5 w-3.5 text-primary" />
            {isFetching ? 'Refreshing…' : 'Auto-refreshing'}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            leftIcon={<RefreshCw className={isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />}
          >
            Refresh
          </Button>
        </div>

        {/* Full health card (connection hero + all readouts) */}
        <SystemHealthCard
          health={health}
          isError={isError}
          lastUpdated={dataUpdatedAt || undefined}
          now={now}
        />

        {/* Telemetry */}
        <SettingsCard title="Telemetry" description="OpenTelemetry export configuration.">
          {!health ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading…</div>
          ) : (
            <div className="divide-y divide-border">
              <InfoRow
                label="OpenTelemetry"
                value={<StatusPip state={health.otel.enabled ? 'ok' : 'neutral'}>{health.otel.enabled ? 'Enabled' : 'Disabled'}</StatusPip>}
              />
              {health.otel.serviceName && <InfoRow label="Service name" value={<span className="font-mono">{health.otel.serviceName}</span>} />}
              {health.otel.endpoint && <InfoRow label="Endpoint" value={<span className="font-mono break-all">{health.otel.endpoint}</span>} />}
            </div>
          )}
        </SettingsCard>

        {/* Sandbox execution (from Advanced) */}
        <SettingsCard
          title="Sandbox execution"
          description="When enabled, code generation runs inside an isolated Docker sandbox."
        >
          {sandboxLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading sandbox config…</div>
          ) : sandbox ? (
            <div className="divide-y divide-border">
              <InfoRow
                label="Status"
                value={
                  <span className={sandbox.enabled ? 'inline-flex items-center gap-1.5 text-success' : 'inline-flex items-center gap-1.5 text-muted-foreground'}>
                    <Shield className="h-3.5 w-3.5" />
                    {sandbox.enabled ? 'Enabled' : 'Disabled (host CLI)'}
                  </span>
                }
              />
              {sandbox.enabled && (
                <>
                  <InfoRow label="Provider" value={sandbox.provider ?? 'auto'} />
                  <InfoRow label="Image" value={sandbox.image ?? 'default'} />
                  <InfoRow label="Auto-destroy" value={sandbox.autoDestroy ? 'Yes' : 'No'} />
                </>
              )}
              <div className="pt-2 text-[10px] text-muted-foreground">
                To toggle sandbox mode, set <code className="font-mono">SANDBOX_ENABLED=true</code> and restart the server.
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sandbox config unavailable.</p>
          )}
        </SettingsCard>

        {/* Runtime (from Advanced) */}
        <SettingsCard title="Runtime">
          <div className="divide-y divide-border">
            <InfoRow label="Database" value={<span className="inline-flex items-center gap-1.5"><Box className="h-3.5 w-3.5 text-muted-foreground" />SQLite (WAL)</span>} />
            <InfoRow label="Streaming" value={<span className="inline-flex items-center gap-1.5"><Server className="h-3.5 w-3.5 text-muted-foreground" />SSE (durable)</span>} />
          </div>
        </SettingsCard>

        {/* Raw snapshot timestamp */}
        {health && (
          <SettingsCard title="Snapshot">
            <div className="divide-y divide-border">
              <InfoRow label="Server time" value={<span className="font-mono">{new Date(health.timestamp).toLocaleString()}</span>} />
              <InfoRow label="Running chat sessions" value={String(health.runningChatIds.length)} />
            </div>
          </SettingsCard>
        )}
      </div>
    </div>
  );
}
