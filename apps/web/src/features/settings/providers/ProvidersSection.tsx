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
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { HarnessProviderStatus } from '@generatorai/shared';
import {
  useHarnessProviders,
  useSetDefaultProvider,
  useSignInProvider,
  useTestAllProviders,
  useTestProviderConnection,
  useProviderLogout,
  type ProviderActionResult,
} from '@/hooks/harnessQueries.js';
import { ProviderBrandIcon } from '@/ui/icons/vendor/VendorIcons.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
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
  codex: 'This build ships the Codex CLI, so this usually means its platform package could not be installed. Install Codex with `npm i -g @openai/codex` or the ChatGPT desktop app, or set CODEX_CLI_PATH to its location — then restart GeneratorAI.',
};

export function ProvidersSection() {
  const { data, isLoading } = useHarnessProviders();
  const testAllMutation = useTestAllProviders();
  const testOneMutation = useTestProviderConnection();
  const signInMutation = useSignInProvider();
  const signOutMutation = useProviderLogout();
  const makeDefaultMutation = useSetDefaultProvider();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const providers = data?.providers ?? [];
  const primary = data?.primary;

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
      title="Model Providers"
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
                  <ProviderBrandIcon provider={p.type} className="size-4 shrink-0" />
                  {p.label}
                </span>
              }
              badges={
                <>
                  {p.type === primary ? <Badge tone="neutral">Default</Badge> : null}
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
              />
            </CatalogRow>
          ))}
        </div>
      )}

      {message ? <Callout tone={message.tone === 'ok' ? 'ok' : 'err'}>{message.text}</Callout> : null}
    </SettingsSection>
  );
}

function ConnectionBadge({ provider, checking }: { provider: HarnessProviderStatus; checking: boolean }) {
  if (checking) return <Badge tone="neutral">Checking…</Badge>;
  if (provider.ready) return <Badge tone="ok">Connected</Badge>;
  return <Badge tone="err">{provider.installed ? 'Not signed in' : 'Not installed'}</Badge>;
}

function ProviderDetails({
  provider,
  isDefault,
  busy,
  onTest,
  onMakeDefault,
  onSignIn,
  onSignOut,
}: {
  provider: HarnessProviderStatus;
  isDefault: boolean;
  busy: boolean;
  onTest: () => void;
  onMakeDefault: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon="refresh" loading={busy} onClick={onTest}>
          Test connection
        </Button>
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
          { label: 'SDK installed', value: provider.installed ? 'Yes' : 'No' },
          { label: 'Client running', value: provider.connected ? 'Yes' : 'No' },
          { label: 'Authenticated', value: provider.authenticated ? 'Yes' : 'No' },
        ]}
      />

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
