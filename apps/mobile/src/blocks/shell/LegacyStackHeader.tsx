// The detail header for legacy screens that still set their title and trailing controls through navigator options
// (workflow, script, automation, project, codebase, PR, files, the legacy Changes / Terminal), until M7/M8 rebuild
// them on the kit Screen (MD-141). Kit parts in the detail role: Back (walks up the IA without history), the
// breadcrumb of real ancestors over the title, then the screen's own trailing controls. JS on both platforms.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { Breadcrumb } from '../../ui/layout/Breadcrumb';
import { backLabel } from '../../ui/native/router/Header';
import { IconButton } from '../../ui/primitives/IconButton';
import { Text } from '../../ui/primitives/Text';
import { pathCrumbs } from './crumbs';
import { parentHref } from './parentHref';
import { routePath } from './routePath';
import { useBreadcrumb } from './useHeaderNav';

type Href = Parameters<typeof router.replace>[0];

export interface LegacyStackHeaderProps {
  options: { title?: string; headerRight?: (props: { canGoBack: boolean; tintColor?: string }) => React.ReactNode };
  route: { name: string; params?: unknown };
}

export function LegacyStackHeader({ options, route }: LegacyStackHeaderProps): React.ReactElement {
  const path = routePath(route.name, route.params);
  const crumbs = useBreadcrumb(useMemo(() => pathCrumbs(path), [path]));
  const right = options.headerRight?.({ canGoBack: router.canGoBack() });
  const onBack = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace((parentHref(path) ?? '/') as Href);
  };
  return (
    <View className="min-h-bar flex-row items-center gap-1 bg-surface pe-2 ps-1">
      <IconButton icon="back" label={backLabel(crumbs)} onPress={onBack} />
      <View className="min-w-0 flex-1 justify-center">
        {crumbs.length ? <Breadcrumb segments={crumbs} /> : null}
        <Text role="detailTitle" numberOfLines={1} accessibilityRole="header">
          {options.title ?? ''}
        </Text>
      </View>
      {right ? <View className="flex-row items-center gap-1">{right}</View> : null}
    </View>
  );
}
