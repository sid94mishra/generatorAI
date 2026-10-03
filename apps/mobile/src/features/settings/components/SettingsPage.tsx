// The frame every Settings section shares (04 §2.8): Header `detail` with the "Settings" breadcrumb (plus any deeper
// crumbs), the grouped background, an optional one-paragraph intro under the header, the screen states and pull to
// refresh. Sections put their ListSections inside.
import React, { useMemo } from 'react';
import { View } from 'react-native';

import { SETTINGS_HREF } from '../../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack, type CrumbInput } from '../../../blocks/shell/useHeaderNav';
import { Screen } from '../../../ui/layout/Screen';
import type { ScreenState } from '../../../ui/layout/Screen/Screen.types';
import { Header } from '../../../ui/native/router/Header';
import type { HeaderAction } from '../../../ui/native/router/Header/Header.types';
import { Text } from '../../../ui/primitives/Text';

export interface SettingsPageProps {
  title: string;
  intro?: string;
  /** Crumbs after "Settings" (MSetMcpAdd: "MCP servers"). */
  crumbs?: ReadonlyArray<CrumbInput>;
  actions?: ReadonlyArray<HeaderAction>;
  state?: ScreenState;
  onRefresh?: () => Promise<void>;
  bottomAccessory?: React.ReactElement;
  keyboard?: 'none' | 'form';
  children?: React.ReactNode;
  testID: string;
}

export function SettingsPage({ title, intro, crumbs, actions, state, onRefresh, bottomAccessory, keyboard, children, testID }: SettingsPageProps): React.ReactElement {
  const onBack = useHeaderBack();
  const trail = useMemo(() => [{ label: 'Settings', href: SETTINGS_HREF }, ...(crumbs ?? [])], [crumbs]);
  const breadcrumb = useBreadcrumb(trail);
  return (
    <Screen
      header={<Header role="detail" title={title} breadcrumb={breadcrumb} onBack={onBack} {...(actions ? { actions } : {})} />}
      background="grouped"
      {...(state ? { state } : {})}
      {...(onRefresh ? { onRefresh } : {})}
      {...(bottomAccessory ? { bottomAccessory } : {})}
      {...(keyboard ? { keyboard } : {})}
      testID={testID}
    >
      <View className="gap-5 pb-8 pt-1">
        {intro ? (
          <Text role="subhead" tone="fg-2" className="px-4">
            {intro}
          </Text>
        ) : null}
        {children}
      </View>
    </Screen>
  );
}
