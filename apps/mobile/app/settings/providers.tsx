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
import { Check, Cpu, RefreshCw } from 'lucide-react-native';
import { queryKeys, type ProviderStatus } from '@generatorai/client-core';

import { useApi } from '../../src/api/useApi';
import { Badge, Card, type Tone } from '../../src/components/ui/primitives';
import { Button, IconButton } from '../../src/components/ui/Button';
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
          {(providers.data?.providers ?? []).map((provider) => {
            const state = readiness(provider);
            const isDefault = provider.type === providers.data?.primary;

            return (
              <Card key={provider.type} className="gap-3 p-4">
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-subtle">
                    <Cpu size={18} color={provider.ready ? colors.success : colors['muted-foreground']} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="text-md font-semibold text-foreground">{provider.label}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {provider.modelCount} model{provider.modelCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Badge label={state.label} tone={state.tone} />
                </View>

                {provider.error ? (
                  <Text className="text-xs leading-relaxed text-danger">{provider.error}</Text>
                ) : null}

                {!provider.authenticated && provider.installed ? (
                  <Text className="text-xs leading-relaxed text-muted-foreground">
                    Sign in by running this provider's CLI login on the machine hosting GeneratorAI.
                    A phone cannot complete that flow.
                  </Text>
                ) : null}

                {isDefault ? (
                  <View className="flex-row items-center gap-1.5">
                    <Check size={14} color={colors.primary} />
                    <Text className="text-sm text-primary">Default for new chats</Text>
                  </View>
                ) : (
                  <Button
                    label="Make default"
                    variant="secondary"
                    size="sm"
                    disabled={!provider.ready}
                    loading={setDefault.isPending && setDefault.variables === provider.type}
                    onPress={() => setDefault.mutate(provider.type)}
                  />
                )}
              </Card>
            );
          })}

          {setDefault.isError ? (
            <Text className="px-1 text-sm text-danger">
              Could not change the default provider. It may no longer be ready.
            </Text>
          ) : null}

          <Text className="px-1 pt-2 text-xs leading-relaxed text-muted-foreground">
            Changing the default only affects chats created afterwards. Existing conversations keep
            the provider they started on.
          </Text>
        </>
      )}
    </Screen>
  );
}
