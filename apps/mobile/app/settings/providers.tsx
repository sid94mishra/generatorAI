// ────────────────────────────────────────────────────────────────
// Settings › Model providers.
//
// Web calls this "Model Providers" and lets you test a connection and make
// one the default. Both are available here. What is NOT available is entering
// credentials: a provider is authenticated by running its CLI's login flow on
// the host machine, which a phone cannot do — so the screen explains the
// failure instead of offering a text field that leads nowhere.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw } from 'lucide-react-native';
import { queryKeys, type ProviderStatus } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { requireStepUp } from '../../src/auth/stepUp';
import { ProviderBrandIcon } from '../../src/components/brand/VendorIcons';
import { Badge, SectionHeader, type Tone } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { IconButton } from '../../src/components/ui/Button';
import { ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

function readiness(provider: ProviderStatus): { label: string; tone: Tone } {
  if (provider.ready) return { label: 'Ready', tone: 'success' };
  if (!provider.installed) return { label: 'Not installed', tone: 'neutral' };
  if (!provider.authenticated) return { label: 'Not signed in', tone: 'warning' };
  return { label: 'Unavailable', tone: 'danger' };
}

export default function ProvidersScreen(): React.ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();

  const providers = useQuery({
    queryKey: queryKeys.providers(),
    queryFn: () => api.harness.providers(),
  });

  // A forced re-probe spawns each provider's CLI, so it only ever runs on an
  // explicit tap — never on mount or focus.
  const reprobe = useMutation({
    mutationFn: () => api.harness.providers(true),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.providers(), data),
  });

  const setDefault = useMutation({
    mutationFn: (type: string) => api.harness.setDefault(type),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.providers() });
      void queryClient.invalidateQueries({ queryKey: ['harness', 'models'] });
    },
  });

  const all = providers.data?.providers ?? [];
  // Ready first: the list exists to pick a default, and only a ready
  // provider can be one.
  const ready = all.filter((p) => p.ready);
  const blocked = all.filter((p) => !p.ready);

  return (
    <Screen
      title="Providers"
      back
      trailing={
        <IconButton
          accessibilityLabel="Re-check providers"
          icon={<RefreshCw size={18} color={colors['muted-foreground']} />}
          onPress={() => reprobe.mutate()}
          disabled={reprobe.isPending}
        />
      }
      onRefresh={() => void providers.refetch()}
      refreshing={providers.isFetching}
    >
      {providers.isLoading ? (
        <SkeletonList rows={2} />
      ) : providers.isError ? (
        <ErrorState message="Could not reach the provider registry." onRetry={() => void providers.refetch()} />
      ) : (
        <>
          {/* Choosing a default is a RADIO decision, so it is drawn as one:
              a grouped list with a tick, ready providers first. It used to be
              five tall cards each with its own "Make default" button, three of
              which were permanently dead — five independent-looking commands
              for what is really one choice. */}
          <SectionHeader title="Available" />
          <ListGroup>
            {ready.map((provider) => (
              <ListRow
                key={provider.type}
                title={provider.label}
                subtitle={`${provider.modelCount} model${provider.modelCount === 1 ? '' : 's'}${
                  provider.type === providers.data?.primary ? ' · default for new chats' : ''
                }`}
                icon={
                  <ProviderBrandIcon
                    provider={provider.type}
                    size={20}
                    {...(provider.type === 'copilot' ? { color: colors.foreground } : {})}
                  />
                }
                chevron={false}
                selected={provider.type === providers.data?.primary}
                accessibilityLabel={`${provider.label}, ${provider.modelCount} models`}
                accessibilityHint={
                  provider.type === providers.data?.primary
                    ? 'Already the default for new chats'
                    : 'Makes this the default for new chats'
                }
                // NOT disabled when it is already the default: dimming the
                // current selection makes the one active provider look like
                // the inactive one. The tick says it is chosen; pressing it
                // again simply does nothing.
                disabled={setDefault.isPending}
                trailing={
                  provider.type === providers.data?.primary ? (
                    <Check size={18} color={colors.primary} />
                  ) : (
                    <View className="h-[18px] w-[18px]" />
                  )
                }
                // `admin:harnesses` — a server setting, so the first change
                // per session takes the local step-up like every other admin
                // write. A cancelled prompt is not an error.
                onPress={() => {
                  if (provider.type === providers.data?.primary) return;
                  void requireStepUp('Confirm changing the default AI provider').then((ok) => {
                    if (ok) setDefault.mutate(provider.type);
                  });
                }}
              />
            ))}
          </ListGroup>

          {blocked.length > 0 ? (
            <>
              <SectionHeader title="Not available on this machine" />
              <ListGroup>
                {blocked.map((provider) => {
                  const state = readiness(provider);
                  return (
                    <ListRow
                      key={provider.type}
                      title={provider.label}
                      subtitle={
                        provider.error ??
                        (provider.installed
                          ? "Sign in by running this provider's CLI login on the machine hosting GeneratorAI — a phone cannot complete that flow."
                          : 'Install this provider on the machine hosting GeneratorAI to use it.')
                      }
                      icon={
                        <ProviderBrandIcon
                          provider={provider.type}
                          size={20}
                          {...(provider.type === 'copilot' ? { color: colors.foreground } : {})}
                        />
                      }
                      chevron={false}
                      trailing={<Badge label={state.label} tone={state.tone} />}
                    />
                  );
                })}
              </ListGroup>
            </>
          ) : null}

          {setDefault.isError ? (
            <Text className="text-sm text-danger">
              Could not change the default provider. It may no longer be ready.
            </Text>
          ) : null}

          <Text className="pt-2 text-xs leading-relaxed text-muted-foreground">
            Changing the default only affects chats created afterwards. Existing conversations keep
            the provider they started on.
          </Text>
        </>
      )}
    </Screen>
  );
}
