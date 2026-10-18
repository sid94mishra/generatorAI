// ────────────────────────────────────────────────────────────────
// F-settings-04 Model providers (04 §3.1). Every installed provider runs
// side by side, so this shows each one's LIVE readiness (installed →
// connected → authenticated) and the model catalog it actually serves for
// the signed-in account. There is no "standby": a provider that passes its
// readiness probe is usable right now, no activation step required.
//
// "Default" only means which provider handles a request that doesn't name
// one (D-55, G-09; `buildModelPickerCatalog` never defaults to an unready
// provider).
//
// Experimental providers (D-131): the server hides providers that are not
// fully tested from every client; the group at the end reveals or hides them
// (admin:harnesses; an operator's GENERATORAI_EXPERIMENTAL_PROVIDERS reveal is
// shown and cannot be switched off here).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { HarnessProviderStatus, HarnessProviderVisibility } from '@generatorai/shared';
import {
  useHarnessProviders,
  useHarnessVisibility,
  useInstallProvider,
  useSetHarnessVisibility,
  useSetDefaultProvider,
  useSignInProvider,
  useTestAllProviders,
  useTestProviderConnection,
  useProviderLogout,
  type ProviderActionResult,
} from '@/hooks/harnessQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { CatalogRow } from '../CatalogRow.js';

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  copilot: 'GitHub Copilot SDK — GPT, Claude, and Gemini models via your GitHub account.',
  'claude-agent': 'Claude Agent SDK — agentic execution with native tool use.',
  codex: 'OpenAI Codex app-server — GPT models via your ChatGPT sign-in or API key.',
  opencode: 'OpenCode server — models from any provider OpenCode is configured for.',
  acp: 'Agent Client Protocol — any ACP-compatible agent.',
};

const SIGN_IN_HINTS: Record<string, string> = {
  codex: 'Sign in with your ChatGPT account using the button above (or run `codex login` in a terminal), then test the connection.',
  'claude-agent': 'Run `claude` in a terminal and sign in, then test the connection.',
};

const INSTALL_HINTS: Record<string, string> = {
  copilot: 'The Copilot CLI is downloaded the first time you use it (about 155 MB), so the app itself stays smaller. Download it above, then sign in.',
  codex: 'This build ships the Codex CLI, so this usually means its platform package could not be installed. Install Codex with `npm i -g @openai/codex` or the ChatGPT desktop app, or set CODEX_CLI_PATH to its location — then restart GeneratorAI.',
};

export function ProvidersSection() {
  const { data, isLoading } = useHarnessProviders();
  const testAllMutation = useTestAllProviders();
  const testOneMutation = useTestProviderConnection();
  const signInMutation = useSignInProvider();
  const signOutMutation = useProviderLogout();
  const makeDefaultMutation = useSetDefaultProvider();
  const installMutation = useInstallProvider();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const providers = data?.providers ?? [];
  const primary = data?.primary;
  // A default that is not signed in is not what chats use: say which provider is (`inUse`, the server's routing).
  const inUse = data?.inUse;
  const defaultUnused = !!primary && inUse !== undefined && inUse !== primary;

  const report = (result: ProviderActionResult) => setMessage({ tone: result.ok ? 'ok' : 'err', text: result.message });
  const reportError = (err: unknown) => setMessage({ tone: 'err', text: err instanceof Error ? err.message : 'Network error' });

  const testAll = async (): Promise<void> => {
    setMessage(null);
    setBusy('__all__');
    try {
      report(await testAllMutation.mutateAsync());
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const testOne = async (p: HarnessProviderStatus): Promise<void> => {
    setMessage(null);
    setBusy(p.type);
    try {
      report(await testOneMutation.mutateAsync(p));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const signIn = async (p: HarnessProviderStatus): Promise<void> => {
    setMessage(null);
    setBusy(p.type);
    try {
      report(await signInMutation.mutateAsync(p));
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async (p: HarnessProviderStatus): Promise<void> => {
    setMessage(null);
    setBusy(p.type);
    try {
      await signOutMutation.mutateAsync(p.type);
      setMessage({ tone: 'ok', text: `${p.label} signed out.` });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async (p: HarnessProviderStatus): Promise<void> => {
    setMessage(null);
    setBusy(p.type);
    try {
      await makeDefaultMutation.mutateAsync(p.type);
      setMessage({ tone: 'ok', text: `${p.label} is now the default provider.` });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection
      title="Model providers"
      description="All connected providers are available at once — a chat or workflow stage can use any model from any of them. The default provider only handles requests that don't pick one."
    >
      <div className="flex items-center justify-between">
        <span className="text-small text-fg-3">
          {providers.filter((p) => p.ready).length} of {providers.length} connected
        </span>
        <Button variant="secondary" size="sm" icon="refresh" loading={busy === '__all__'} onClick={() => void testAll()}>
          Test all connections
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-small text-fg-3">
          <Spinner size={14} /> Checking providers…
        </div>
      ) : providers.length === 0 ? (
        <p className="text-small text-err">Failed to load provider info.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <CatalogRow
              key={p.type}
              icon={undefined}
              title={
                <span className="inline-flex items-center gap-2">
                  <ProviderLogo provider={p.type} size={16} />
                  {p.label}
                </span>
              }
              badges={
                <>
                  {p.type === primary ? <Badge tone={defaultUnused ? 'warn' : 'neutral'}>{defaultUnused ? 'Default · not in use' : 'Default'}</Badge> : null}
                  {defaultUnused && p.type === inUse ? <Badge tone="ok">Used for new chats</Badge> : null}
                  <ConnectionBadge provider={p} checking={busy === p.type || busy === '__all__'} />
                </>
              }
              subtitle={PROVIDER_DESCRIPTIONS[p.type] ?? `${p.label} provider.`}
              open={expanded === p.type}
              onOpenChange={(open) => setExpanded(open ? p.type : null)}
              control={busy === p.type ? <Spinner size={14} className="text-fg-3" /> : undefined}
            >
              <ProviderDetails
                provider={p}
                isDefault={p.type === primary}
                busy={busy === p.type}
                onTest={() => void testOne(p)}
                onMakeDefault={() => void makeDefault(p)}
                onSignIn={() => void signIn(p)}
                onSignOut={() => void signOut(p)}
                onInstall={() => installMutation.mutate(p.type)}
              />
            </CatalogRow>
          ))}
        </div>
      )}

      {message ? <Callout tone={message.tone === 'ok' ? 'ok' : 'err'}>{message.text}</Callout> : null}

      <ExperimentalProviders />
    </SettingsSection>
  );
}

/**
 * Providers the server hides until revealed (D-131). Every supported provider
 * that is not stable is listed with a switch; the server enforces it (hidden =
 * absent from every provider/model API, cannot run a turn).
 */
function ExperimentalProviders() {
  const { data } = useHarnessVisibility();
  const setVisibility = useSetHarnessVisibility();
  const [error, setError] = useState<string | null>(null);
  const experimental = (data?.providers ?? []).filter((p) => p.stability === 'experimental');
  if (experimental.length === 0) return null;

  const toggle = async (p: HarnessProviderVisibility, visible: boolean): Promise<void> => {
    setError(null);
    try {
      await setVisibility.mutateAsync({ visible: { [p.type]: visible } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change provider visibility.');
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="experimental-providers">
      <SectionHeader
        variant="label"
        title="Experimental providers"
      />
      <p className="text-small text-fg-3">
        Not fully tested, so this server hides them from every app until revealed. Devices with admin:harnesses can change this.
      </p>
      <div className="flex flex-col divide-y divide-line-soft rounded-control border border-line">
        {experimental.map((p) => (
          <div key={p.type} className="flex items-center gap-3 px-3 py-2">
            <ProviderLogo provider={p.type} size={16} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-ui text-fg">{p.label}</span>
              <span className="text-small text-fg-3">
                {p.source === 'env'
                  ? 'Revealed by GENERATORAI_EXPERIMENTAL_PROVIDERS on the server.'
                  : p.visible
                    ? 'Shown to every app.'
                    : 'Hidden from every app.'}
              </span>
            </div>
            <Switch
              aria-label={`Show ${p.label}`}
              checked={p.visible}
              disabled={p.source === 'env' || setVisibility.isPending}
              onCheckedChange={(next) => void toggle(p, next)}
            />
          </div>
        ))}
      </div>
      {error ? <Callout tone="err">{error}</Callout> : null}
    </div>
  );
}

function ConnectionBadge({ provider, checking }: { provider: HarnessProviderStatus; checking: boolean }) {
  if (checking) return <Badge tone="neutral">Checking…</Badge>;
  if (provider.ready) return <Badge tone="ok">Connected</Badge>;
  // Not an error: an optional provider that is absent is neutral (the model picker
  // dims it the same way); an installed one waiting for sign-in asks for action.
  if (provider.installing) return <Badge tone="neutral">Downloading…</Badge>;
  return provider.installed ? <Badge tone="warn">Not signed in</Badge> : <Badge tone="neutral">Not installed</Badge>;
}

function ProviderDetails({
  provider,
  isDefault,
  busy,
  onTest,
  onMakeDefault,
  onSignIn,
  onSignOut,
  onInstall,
}: {
  provider: HarnessProviderStatus;
  isDefault: boolean;
  busy: boolean;
  onTest: () => void;
  onMakeDefault: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onInstall: () => void;
}) {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  const progress = provider.installing;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon="refresh" loading={busy} onClick={onTest}>
          Test connection
        </Button>
        {provider.installable && !progress ? (
          <Button variant="primary" size="sm" icon="download" disabled={busy} onClick={onInstall} data-testid={`provider-install-${provider.type}`}>
            Download {provider.label} CLI
          </Button>
        ) : null}
        {provider.supportsLogin && provider.installed && !provider.authenticated ? (
          <Button variant="primary" size="sm" icon="power" disabled={busy} onClick={onSignIn} data-testid={`provider-sign-in-${provider.type}`}>
            Sign in
          </Button>
        ) : null}
        {provider.supportsLogin && provider.authenticated ? (
          <Button variant="ghost" size="sm" icon="power" disabled={busy} onClick={onSignOut} data-testid={`provider-sign-out-${provider.type}`}>
            Sign out
          </Button>
        ) : null}
        {provider.ready && !isDefault ? (
          <Button variant="primary" size="sm" icon="pin" onClick={onMakeDefault}>
            Make default
          </Button>
        ) : null}
      </div>

      <KeyValueList
        labelWidth={104}
        dense
        items={[
          { label: 'Provider id', value: provider.type, mono: true },
          { label: 'Installed', value: provider.installed ? 'Yes' : 'No' },
          { label: 'Client running', value: provider.connected ? 'Yes' : 'No' },
          { label: 'Authenticated', value: provider.authenticated ? 'Yes' : 'No' },
        ]}
      />

      {progress ? (
        <ProgressBar
          value={progress.totalBytes ? progress.receivedBytes : null}
          max={progress.totalBytes ?? 100}
          label={`Downloading the ${provider.label} CLI${progress.totalBytes ? ` · ${mb(progress.receivedBytes)} of ${mb(progress.totalBytes)} MB` : ''}`}
        />
      ) : null}
      {provider.error ? <Callout tone="err">{provider.error}</Callout> : null}

      <div className="flex flex-col gap-1.5">
        <SectionHeader variant="label" title={`Available models${provider.ready ? ` (${provider.modelCount})` : ''}`} />
        {!provider.ready ? (
          <p className="text-small text-fg-3">
            {provider.installed
              ? (SIGN_IN_HINTS[provider.type] ?? 'Sign in to this provider, then test the connection to load its catalog.')
              : (INSTALL_HINTS[provider.type] ?? "This provider's SDK is not installed in this build.")}
          </p>
        ) : provider.models.length === 0 ? (
          <p className="text-small text-fg-3">No models available for this account.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {provider.models.map((model) => (
              <div key={model.id} className="flex items-start gap-2.5 rounded-control-sm border border-line bg-sunken px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-ui font-medium text-fg">{model.name ?? model.id}</span>
                    {model.isDefault ? <Badge size="sm">default</Badge> : null}
                    <span className="ml-auto shrink-0 font-mono text-micro text-fg-3">{model.id}</span>
                  </div>
                  {model.description ? <p className="mt-0.5 text-small text-fg-3">{model.description}</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
