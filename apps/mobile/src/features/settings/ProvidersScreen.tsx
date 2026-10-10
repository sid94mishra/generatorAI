// Settings › Model providers (MSetProviders, MD-35, MDF-108; `/settings/providers`): "n of m connected" + Test all;
// one collapsible card per provider the server serves (D-131): name, neutral "Default" badge, status
// dot + word, description; open: Test connection, Sign in (the provider's browser flow in an auth session, then
// re-probe until signed in) / Sign out, Make default, the readiness facts, the error and the model catalog or the
// hint. Sign in / out and Make default need `admin:harnesses` (else the requires-admin row, MD-30) and a step-up.
// Each provider shows its logo (the shared registry, D-132). "Experimental providers" (D-131, admin:harnesses) reveals
// or hides the providers the server keeps from every app until they are fully tested — the desktop's same group.
import React, { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { HarnessProviderStatus } from '@generatorai/shared';

import { KeyValueList } from '../../ui/layout/KeyValueList';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { SectionHeader } from '../../ui/layout/SectionHeader';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { Collapsible } from '../../ui/primitives/Collapsible';
import { Icon } from '../../ui/primitives/Icon';
import { ProviderLogo } from '../../ui/primitives/ProviderLogo';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { providerActions, providerDescription, providerHint, providerStatus } from './model/providerView';
import {
  useDefaultProvider,
  useHarnessVisibility,
  useProviderSignIn,
  useProviderSignOut,
  useProvidersLive,
  useSetHarnessVisibility,
  useTestProviders,
  type ProviderOutcome,
} from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

const openAuth = async (url: string): Promise<void> => {
  await WebBrowser.openAuthSessionAsync(url);
};

function ProviderCard({
  provider,
  isDefault,
  busy,
  canWrite,
  open,
  onOpenChange,
  run,
}: {
  provider: HarnessProviderStatus;
  isDefault: boolean;
  busy: boolean;
  canWrite: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: (kind: 'test' | 'signIn' | 'signOut' | 'default', p: HarnessProviderStatus) => void;
}): React.ReactElement {
  const status = providerStatus(provider, busy);
  const actions = providerActions(provider, isDefault);
  const hint = providerHint(provider);
  const header = (
    <View className="flex-row items-start gap-3">
      <View className="size-10 items-center justify-center rounded-card bg-selected">
        <ProviderLogo provider={provider.type} size={24} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Text role="headline" weight={600}>
            {provider.label}
          </Text>
          {isDefault ? <Badge label="Default" icon="pin" size="sm" /> : null}
        </View>
        <View className="flex-row items-center gap-1.5">
          <StatusDot health={status.health} size="sm" />
          <Text role="footnote" tone={status.health === 'ok' ? 'ok' : status.health === 'err' ? 'err' : 'fg-3'}>
            {status.label}
          </Text>
        </View>
        <Text role="footnote" tone="fg-2">
          {providerDescription(provider)}
        </Text>
      </View>
    </View>
  );
  return (
    <Card radius="group" padding="sm" testID={`provider-${provider.type}`}>
      <Collapsible header={header} expanded={open} onExpandedChange={onOpenChange} accessibilityLabel={`${provider.label}, ${status.label}${isDefault ? ', default' : ''}`}>
        <View className="gap-3 pt-3">
          <View className="flex-row flex-wrap gap-2">
            <Button label="Test connection" icon="refresh" variant="secondary" size="sm" loading={busy} onPress={() => run('test', provider)} testID={`provider-test-${provider.type}`} />
            {actions.signIn && canWrite ? <Button label="Sign in" icon="power" size="sm" disabled={busy} onPress={() => run('signIn', provider)} testID={`provider-sign-in-${provider.type}`} /> : null}
            {actions.signOut && canWrite ? <Button label="Sign out" icon="power" variant="ghost" size="sm" disabled={busy} onPress={() => run('signOut', provider)} testID={`provider-sign-out-${provider.type}`} /> : null}
            {actions.makeDefault && canWrite ? <Button label="Make default" icon="pin" variant="tonal" size="sm" disabled={busy} onPress={() => run('default', provider)} testID={`provider-default-${provider.type}`} /> : null}
          </View>
          <KeyValueList
            items={[
              { label: 'Provider id', value: provider.type, mono: true },
              { label: 'SDK installed', value: provider.installed ? 'Yes' : 'No' },
              { label: 'Client running', value: provider.connected ? 'Yes' : 'No' },
              { label: 'Authenticated', value: provider.authenticated ? 'Yes' : 'No' },
            ]}
          />
          {provider.error ? <Callout tone="err" title={provider.error} /> : null}
          {hint ? (
            <Text role="footnote" tone="fg-3">
              {hint}
            </Text>
          ) : (
            <View className="gap-1">
              <SectionHeader title="Available models" variant="label" count={provider.models.length} />
              {provider.models.map((m) => (
                <View accessibilityRole="text" key={m.id} className="min-h-item flex-row items-center gap-2" accessible accessibilityLabel={`${m.name ?? m.id}, ${m.id}`}>
                  <Text role="subhead" numberOfLines={1} className="flex-1">
                    {m.name ?? m.id}
                  </Text>
                  {m.isDefault ? <Badge label="default" size="sm" /> : null}
                  <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
                    {m.id}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Collapsible>
    </Card>
  );
}

export default function ProvidersScreen(): React.ReactElement {
  const providers = useProvidersLive();
  const test = useTestProviders();
  const signIn = useProviderSignIn(openAuth);
  const signOut = useProviderSignOut();
  const setDefault = useDefaultProvider();
  const access = useScopeAccess('admin:harnesses', 'Sign providers in and change the default from this device');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ProviderOutcome | null>(null);
  const all = providers.data?.providers ?? [];
  const primary = providers.data?.primary;
  const effectiveOpen = open ?? (all.find((p) => p.type === primary) ?? all[0])?.type ?? null;

  const run = (kind: 'test' | 'signIn' | 'signOut' | 'default' | 'all', p: HarnessProviderStatus | null): void => {
    setMessage(null);
    setBusy(p?.type ?? '__all__');
    const done = (outcome: ProviderOutcome | undefined): void => {
      if (outcome) {
        setMessage(outcome);
        haptic(outcome.ok ? 'success' : 'error');
      }
    };
    const fail = (e: unknown): void => setMessage({ ok: false, message: e instanceof Error ? e.message : 'Network error' });
    let work: Promise<ProviderOutcome | undefined>;
    if (kind === 'test' || kind === 'all') work = test.mutateAsync(p);
    else if (kind === 'signIn') work = adminWrite(`Sign in to ${p!.label}`, () => signIn.mutateAsync(p!));
    else if (kind === 'signOut') work = adminWrite(`Sign out of ${p!.label}`, async () => {
      await signOut.mutateAsync(p!.type);
      return { ok: true, message: `${p!.label} signed out.` };
    });
    else work = adminWrite(`Make ${p!.label} the default provider`, async () => {
      await setDefault.mutateAsync(p!.type);
      return { ok: true, message: `${p!.label} is now the default provider.` };
    });
    work.then(done, fail).finally(() => setBusy(null));
  };

  const state = providers.isLoading
    ? { kind: 'loading' as const, skeleton: <Skeleton preset="list" count={3} /> }
    : providers.isError && !providers.data
      ? { kind: 'error' as const, error: providers.error, onRetry: () => void providers.refetch(), title: "Couldn't load providers" }
      : { kind: 'ready' as const };

  return (
    <SettingsPage
      title="Model providers"
      intro="Every connected provider is available at once. The default only handles requests that don't pick a model."
      state={state}
      onRefresh={async () => void (await providers.refetch())}
      testID="settings-providers-screen"
    >
      <View className="flex-row items-center justify-between px-4">
        <View className="flex-row items-center gap-1.5">
          <Icon concept="model" size={16} tone="fg-2" />
          <Text role="subhead" weight={600}>
            {all.filter((p) => p.ready).length} of {all.length} connected
          </Text>
        </View>
        <Button label="Test all" icon="refresh" variant="ghost" size="sm" loading={busy === '__all__'} onPress={() => run('all', null)} testID="providers-test-all" />
      </View>
      {message ? (
        <View className="px-4">
          <Callout tone={message.ok ? 'ok' : 'err'} title={message.message} testID="providers-message" />
        </View>
      ) : null}
      {!access.granted ? (
        <ListSection footer="Testing works without it. Signing in and changing the default need admin access.">
          <ListRow kind="requires-admin" icon="lock" title="Sign in and defaults" onPress={access.request} testID="providers-requires-admin" />
        </ListSection>
      ) : null}
      <View className="gap-3 px-4">
        {all.map((p) => (
          <ProviderCard
            key={p.type}
            provider={p}
            isDefault={p.type === primary}
            busy={busy === p.type || busy === '__all__'}
            canWrite={access.granted}
            open={effectiveOpen === p.type}
            onOpenChange={(o) => setOpen(o ? p.type : '')}
            run={run}
          />
        ))}
      </View>
      <ExperimentalProviders canWrite={access.granted} />
    </SettingsPage>
  );
}

/** Providers the server hides until revealed (D-131); the server enforces it for every app. */
function ExperimentalProviders({ canWrite }: { canWrite: boolean }): React.ReactElement | null {
  const visibility = useHarnessVisibility();
  const setVisibility = useSetHarnessVisibility();
  const [error, setError] = useState<string | null>(null);
  const experimental = (visibility.data?.providers ?? []).filter((p) => p.stability === 'experimental');
  if (experimental.length === 0) return null;
  const toggle = (type: string, label: string, visible: boolean): void => {
    setError(null);
    adminWrite(`${visible ? 'Show' : 'Hide'} ${label}`, () => setVisibility.mutateAsync({ visible: { [type]: visible } })).then(
      () => haptic('success'),
      (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't change provider visibility."),
    );
  };
  return (
    <>
      <ListSection
        title="Experimental providers"
        footer="Not fully tested, so this server hides them from every app until revealed. Changing this needs admin access."
        testID="experimental-providers"
      >
        {experimental.map((p) => (
          <ListRow
            key={p.type}
            kind="toggle"
            leading={<ProviderLogo provider={p.type} />}
            title={p.label}
            subtitle={p.source === 'env' ? 'Revealed by the server environment' : p.visible ? 'Shown to every app' : 'Hidden from every app'}
            switchValue={p.visible}
            onValueChange={(v) => toggle(p.type, p.label, v)}
            disabled={!canWrite || p.source === 'env' || setVisibility.isPending}
            {...(!canWrite ? { disabledReason: 'Needs admin access' } : {})}
            testID={`experimental-provider-${p.type}`}
          />
        ))}
      </ListSection>
      {error ? (
        <View className="px-4">
          <Callout tone="err" title={error} />
        </View>
      ) : null}
    </>
  );
}
