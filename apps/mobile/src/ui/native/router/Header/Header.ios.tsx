// ML-02 Header — iOS (03 ML-02; MD-18, MD-85, MD-86): the native-stack header through expo-router — large title on
// module roots (collapsing to the centred headline), the custom title view (breadcrumb over the detail title) on
// details, and Stack.Toolbar items (Liquid Glass on the iOS 27 SDK): the sidebar toggle, back, trailing actions with
// a ⋯ overflow menu (destructive last, MD-22), the workspace pane toggle with its count, the modal's Cancel and its
// prominent text confirm (MD-85). What the native bar cannot hold — Home's subtitle and the StatusLine — renders here
// at the top of the content.
import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import type { SFSymbol } from 'sf-symbols-typescript';

import { BreadcrumbTitle } from '../../../layout/Breadcrumb';
import { StatusLine } from '../../../layout/StatusLine';
import { useFontScale } from '../../../platform/fontScale';
import { sfSymbolFor, isSeparator } from '../../Menu/menuModel';
import type { HeaderAction, HeaderProps } from './Header.types';
import { backLabel, iosHeaderOptions, paneToggleLabel, sidebarToggleLabel, splitActions } from './headerModel';

export type { HeaderAction, HeaderProps, HeaderRole } from './Header.types';

const sf = (concept: HeaderAction['icon']): SFSymbol => (sfSymbolFor(concept) ?? 'circle') as SFSymbol;

export function Header(props: HeaderProps): React.ReactElement {
  const { role, title, breadcrumb, status, subtitle, actions = [], onSidebarToggle, sidebarToggleState = 'drawer', onBack, paneToggle, modal } = props;
  const fontScale = useFontScale();
  const { inline, overflow } = splitActions(actions, fontScale);
  const detail = role === 'detail' || role === 'workspace';
  const options = {
    ...iosHeaderOptions(props),
    headerTitle: detail ? () => <BreadcrumbTitle breadcrumb={breadcrumb} title={title} /> : undefined,
  };
  return (
    <>
      <Stack.Screen options={options} />
      <Stack.Toolbar placement="left">
        {role === 'top' && onSidebarToggle ? (
          <Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel={sidebarToggleLabel(sidebarToggleState)} selected={sidebarToggleState === 'shown'} onPress={onSidebarToggle} />
        ) : null}
        {detail && onBack ? <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel={backLabel(breadcrumb)} onPress={onBack} /> : null}
        {role === 'modal' && modal ? <Stack.Toolbar.Button onPress={modal.onCancel}>{modal.cancelLabel ?? 'Cancel'}</Stack.Toolbar.Button> : null}
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {inline.map((a) =>
          a.menu?.length ? (
            <Stack.Toolbar.Menu key={a.id} icon={sf(a.icon)} accessibilityLabel={a.label}>
              {a.menu.map((m, i) =>
                isSeparator(m) ? null : (
                  <Stack.Toolbar.MenuAction key={`${m.id}-${i}`} icon={sfSymbolFor(m.icon) as SFSymbol | undefined} destructive={m.destructive} disabled={m.disabled} isOn={m.checked} onPress={() => a.onMenuSelect?.(m.id)}>
                    {m.label}
                  </Stack.Toolbar.MenuAction>
                ),
              )}
            </Stack.Toolbar.Menu>
          ) : (
            <Stack.Toolbar.Button key={a.id} icon={sf(a.icon)} accessibilityLabel={a.label} selected={a.selected} onPress={a.onPress} />
          ),
        )}
        {role === 'workspace' && paneToggle ? (
          <Stack.Toolbar.Button icon="sidebar.right" accessibilityLabel={paneToggleLabel(paneToggle.open, paneToggle.count)} selected={paneToggle.open} onPress={paneToggle.onPress}>
            {paneToggle.count > 0 ? <Stack.Toolbar.Badge>{String(paneToggle.count)}</Stack.Toolbar.Badge> : null}
          </Stack.Toolbar.Button>
        ) : null}
        {overflow.length ? (
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More options">
            {overflow.map((a) => (
              <Stack.Toolbar.MenuAction key={a.id} icon={sf(a.icon)} destructive={a.destructive} onPress={() => a.onPress?.()}>
                {a.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        ) : null}
        {role === 'modal' && modal?.primary ? (
          <Stack.Toolbar.Button variant="prominent" disabled={modal.primary.disabled || modal.primary.loading} onPress={modal.primary.onPress}>
            {modal.primary.label}
          </Stack.Toolbar.Button>
        ) : null}
      </Stack.Toolbar>
      {subtitle ? <View className="px-gutter-title pb-2">{subtitle}</View> : null}
      {detail && status ? <StatusLine status={status} /> : null}
    </>
  );
}
