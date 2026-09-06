// ────────────────────────────────────────────────────────────────
// Settings → Model Providers section.
//
// Every installed provider runs side by side, so this page shows each one's
// LIVE readiness (installed → connected → authenticated) and the model
// catalog that provider actually serves for the signed-in account. There is
// no "standby": a provider that passes its readiness probe is usable right
// now, no activation step required.
//
// The only thing "default" means here is which provider handles a request
// that doesn't name one (a chat or stage can always pick its own).
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import {
  CheckCircle2, AlertTriangle, RefreshCw, Wifi, WifiOff, Cpu, Star,
} from 'lucide-react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { useHarnessProviders, type HarnessProviderInfo } from '@/hooks/queries.js';
import { Button, Badge, Spinner } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { SectionHeader, CatalogAccordionRow } from '../shared.js';
import { ProviderBrandIcon } from '../BrandIcons.js';

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  copilot: 'GitHub Copilot SDK — GPT, Claude, and Gemini models via your GitHub account.',
  'claude-agent': 'Claude Agent SDK — agentic execution with native tool use.',
};

export function ProvidersSection() {
  const platform = usePlatform();
  const { data, isLoading, isFetching, refetch } = useHarnessProviders();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const providers = data?.providers ?? [];
  const primary = data?.primary;

  /** Re-probe every provider (spawns their CLIs, so it can take a moment). */
  const testAll = async (): Promise<void> => {
    setError(null);
    setSuccess(null);
    setBusy('__all__');
    try {
      const res = await fetch(`${platform.baseUrl}/api/harness/providers?refresh=1`);
      if (!res.ok) throw new Error(`Probe failed (${res.status})`);
      const fresh = (await res.json()) as { providers: HarnessProviderInfo[] };
      await refetch();
      const ready = fresh.providers.filter((p) => p.ready);
      setSuccess(
        ready.length > 0
          ? `${ready.length} provider${ready.length === 1 ? '' : 's'} connected: ${ready.map((p) => p.label).join(', ')}`
          : 'No providers are currently connected.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };

  /** Re-probe a single provider and report its result. */
  const testOne = async (p: HarnessProviderInfo): Promise<void> => {
    setError(null);
    setSuccess(null);
    setBusy(p.type);
    try {
      const res = await fetch(`${platform.baseUrl}/api/harness/providers?refresh=1`);
      if (!res.ok) throw new Error(`Probe failed (${res.status})`);
      const fresh = (await res.json()) as { providers: HarnessProviderInfo[] };
      await refetch();
      const me = fresh.providers.find((x) => x.type === p.type);
      if (me?.ready) setSuccess(`${me.label} connected — ${me.modelCount} model${me.modelCount === 1 ? '' : 's'} available.`);
      else setError(`${p.label} is not connected${me?.error ? `: ${me.error}` : '.'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };

  /** Make this provider the one used when a request doesn't name one. */
  const makeDefault = async (p: HarnessProviderInfo): Promise<void> => {
    setError(null);
    setSuccess(null);
    setBusy(p.type);
    try {
      const res = await fetch(`${platform.baseUrl}/api/harness/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: p.type }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error?.message ?? 'Could not set default provider'); return; }
      setSuccess(`${p.label} is now the default provider.`);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Model Providers"
        description="All connected providers are available at once — a chat or workflow stage can use any model from any of them. The default provider only handles requests that don't pick one."
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wifi className="h-3.5 w-3.5 text-primary" />
            {providers.filter((p) => p.ready).length} of {providers.length} connected
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void testAll()}
            loading={busy === '__all__'}
            leftIcon={busy !== '__all__' ? <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> : undefined}
          >
            Test all connections
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner size="sm" /> Checking providers…
          </div>
        ) : providers.length === 0 ? (
          <p className="text-xs text-danger">Failed to load provider info.</p>
        ) : (
          <div className="space-y-2.5">
            {providers.map((p) => (
              <CatalogAccordionRow
                key={p.type}
                icon={<ProviderBrandIcon provider={p.type} className="h-5 w-5" />}
                title={p.label}
                badge={
                  <span className="flex items-center gap-1.5">
                    {p.type === primary && <Badge tone="primary" size="sm">Default</Badge>}
                    <ConnectionPill provider={p} checking={busy === p.type || busy === '__all__'} />
                  </span>
                }
                subtitle={PROVIDER_DESCRIPTIONS[p.type] ?? `${p.label} agent provider.`}
                expanded={expanded === p.type}
                onToggleExpanded={() => setExpanded((cur) => (cur === p.type ? null : p.type))}
                control={
                  busy === p.type ? <Spinner size="sm" className="text-muted-foreground" /> : undefined
                }
              >
                <ProviderDetails
                  provider={p}
                  isDefault={p.type === primary}
                  busy={busy === p.type}
                  onTest={() => void testOne(p)}
                  onMakeDefault={() => void makeDefault(p)}
                />
              </CatalogAccordionRow>
            ))}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-muted px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {success}
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Live connection state for one provider. */
function ConnectionPill({ provider, checking }: { provider: HarnessProviderInfo; checking: boolean }) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Spinner size="sm" /> Checking…
      </span>
    );
  }
  return provider.ready ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
      <Wifi className="h-3.5 w-3.5" /> Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
      <WifiOff className="h-3.5 w-3.5" /> {provider.installed ? 'Not signed in' : 'Not installed'}
    </span>
  );
}

function ProviderDetails({
  provider, isDefault, busy, onTest, onMakeDefault,
}: {
  provider: HarnessProviderInfo;
  isDefault: boolean;
  busy: boolean;
  onTest: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onTest}
          loading={busy}
          leftIcon={!busy ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
        >
          Test connection
        </Button>
        {provider.ready && !isDefault && (
          <Button variant="primary" size="sm" onClick={onMakeDefault} leftIcon={<Star className="h-3.5 w-3.5" />}>
            Make default
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <DetailLine label="Provider id" value={provider.type} mono />
        <DetailLine label="SDK installed" value={provider.installed ? 'Yes' : 'No'} />
        <DetailLine label="Client running" value={provider.connected ? 'Yes' : 'No'} />
        <DetailLine label="Authenticated" value={provider.authenticated ? 'Yes' : 'No'} />
      </div>

      {provider.error && (
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{provider.error}</span>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium text-foreground">
          Available models{provider.ready ? ` (${provider.modelCount})` : ''}
        </div>
        {!provider.ready ? (
          <p className="text-xs text-muted-foreground">
            {provider.installed
              ? 'Sign in to this provider, then test the connection to load its catalog.'
              : 'This provider\u2019s SDK is not installed in this build.'}
          </p>
        ) : provider.models.length === 0 ? (
          <p className="text-xs text-muted-foreground">No models available for this account.</p>
        ) : (
          <div className="grid gap-1.5">
            {/* Each provider lists only ITS OWN catalog — these come straight
                from that provider's live model discovery. */}
            {provider.models.map((model) => (
              <div key={model.id} className="flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2">
                <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{model.name ?? model.id}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{model.id}</span>
                  </div>
                  {/* The provider blurb — for Claude Code this is where the
                      concrete version and per-Mtok pricing are stated. */}
                  {model.description && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{model.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate text-foreground', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
