// The default-model picker (MSetGeneral sheet; `/pickers/model?for=default`, a route sheet opened from a screen,
// MD-62): the provider as a segmented control (a provider that is not signed in is locked, with the reason), the
// MB-03 model list for it, and "Done" (a selection sheet, MD-85). The choice is this device's (MD-30) and is stored
// per server; "Use the server default" clears it.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { findPickerModel } from '@generatorai/client-core';

import { ModelPicker } from '../../blocks/ModelPicker';
import { settingsHref } from '../../blocks/shell/hrefs';
import { useModelPickerCatalog } from '../../blocks/TurnSheet';
import { useAuth } from '../../services/auth/AuthProvider';
import { useDefaultModel, writeDefaultModel, type DefaultModel } from '../../services/prefs/defaultModel';
import { RouteSheet } from '../../ui/native/Sheet';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';

type Href = Parameters<typeof router.replace>[0];

export default function DefaultModelSheet(): React.ReactElement {
  const navigation = useNavigation();
  const { serverId } = useAuth();
  const current = useDefaultModel(serverId);
  const { catalog, loading, error, refresh } = useModelPickerCatalog();
  const [value, setValue] = useState<DefaultModel | null>(current);
  const initialProvider = value?.provider ?? catalog?.defaultProvider ?? catalog?.providers[0]?.type ?? null;
  const [provider, setProvider] = useState<string | null>(null);
  const shown = provider ?? initialProvider;
  const providerInfo = catalog?.providers.find((p) => p.type === shown) ?? null;
  const locked = providerInfo && providerInfo.availability !== 'ready';

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(settingsHref('general') as Href);
  };
  const done = (): void => {
    if (serverId && JSON.stringify(value) !== JSON.stringify(current)) {
      writeDefaultModel(serverId, value);
      haptic('success');
    }
    close();
  };

  return (
    <RouteSheet title="Default model" onDismiss={close} headerAction={{ label: 'Done', onPress: done }} scrollable navigation={navigation as never} testID="default-model-sheet">
      <View className="gap-4 px-4 pb-6">
        {loading ? (
          <Skeleton preset="list" count={4} />
        ) : !catalog ? (
          <ErrorState title="Couldn't load the models" error={error} onRetry={refresh} />
        ) : (
          <>
            {catalog.providers.length > 1 ? (
              <View className="gap-1.5">
                <SegmentedControl
                  accessibilityLabel="Provider"
                  value={shown ?? ''}
                  onValueChange={setProvider}
                  segments={catalog.providers.map((p) => ({ value: p.type, label: p.label, ...(p.availability !== 'ready' ? { locked: true } : {}) }))}
                  fullWidth
                  testID="default-model-provider"
                />
                {locked ? (
                  <View className="flex-row items-center gap-1.5">
                    <Icon concept="lock" size={12} tone="fg-3" />
                    <Text role="footnote" tone="fg-3">
                      {providerInfo.label} isn't signed in, so its models are locked.
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <ModelPicker catalog={catalog} value={value} providerFilter={shown} onValueChange={setValue} />
            {value && !findPickerModel(catalog, value.model, value.provider) ? (
              <Text role="footnote" tone="fg-3">
                The saved model ({value.model}) isn't offered right now; new chats use the server default until it is.
              </Text>
            ) : null}
            <Button label="Use the server default" variant="ghost" onPress={() => setValue(null)} disabled={!value} testID="default-model-clear" />
          </>
        )}
      </View>
    </RouteSheet>
  );
}
