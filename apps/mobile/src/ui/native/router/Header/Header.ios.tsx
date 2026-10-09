// ML-02 Header — iOS (03 ML-02; MD-18, MD-85, MD-86): the native-stack header through expo-router — large title on
// module roots (collapsing to the centred headline), the custom title view (breadcrumb over the detail title) on
// details, and Stack.Toolbar items (Liquid Glass on the iOS 27 SDK): the sidebar toggle, back, trailing actions with
// a ⋯ overflow menu (destructive last, MD-22), the workspace pane toggle with its count, the modal's Cancel and its
// prominent text confirm (MD-85). What the native bar cannot hold — Home's subtitle and the StatusLine — renders here
// at the top of the content.
import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Stack, useFocusEffect, useNavigation } from 'expo-router';
import type { SFSymbol } from 'sf-symbols-typescript';

import { BreadcrumbTitle } from '../../../layout/Breadcrumb';
import { StatusLine } from '../../../layout/StatusLine';
import { useFontScale } from '../../../platform/fontScale';
import { sfSymbolFor } from '../../Menu/menuModel';
import type { HeaderAction, HeaderProps } from './Header.types';
import { dispatchHeaderPress, inlineTitleOpacity, iosHeaderColorOptions, iosHeaderModel, iosHeaderOptions, type IosHeaderModel } from './headerModel';
import { Text } from '../../../primitives/Text';
import { useThemeColors } from '../../../lib/themeColors';

export type { HeaderAction, HeaderProps, HeaderRole } from './Header.types';

const sf = (concept: HeaderAction['icon']): SFSymbol => (sfSymbolFor(concept) ?? 'circle') as SFSymbol;

/** The centred headline that takes over once the in-content large title scrolls under the bar (MD-153). */
function InlineTitle({ title, scroll }: { title: string; scroll?: SharedValue<number> }): React.ReactElement {
  const style = useAnimatedStyle(() => ({ opacity: scroll ? inlineTitleOpacity(scroll.value) : 1 }), [scroll]);
  return (
    <Animated.View style={style}>
      <Text role="headline" numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
    </Animated.View>
  );
}

type Press = (target: string) => void;

/**
 * The bar is applied from values, not identities (MD-162): the navigator options, the title view and both toolbars
 * are memoized on the JSON of what they show, and every press reads the latest props. A caller that passes fresh
 * arrays and inline handlers each render therefore never re-applies the options — re-applying re-renders the
 * navigator, and a screen that re-renders with it (a store it writes from an effect) would loop.
 */
export function Header(props: HeaderProps): React.ReactElement {
  const { role, status, subtitle, scroll } = props;
  const fontScale = useFontScale();
  const colors = useThemeColors();
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const press = useCallback<Press>((target) => dispatchHeaderPress(latest.current, target), []);
  const modelKey = JSON.stringify(iosHeaderModel(props, fontScale));
  const base = iosHeaderOptions(props);
  const optionsKey = JSON.stringify({ ...base, ...iosHeaderColorOptions(colors, base.headerTransparent) });
  const options = useMemo(() => {
    const model = JSON.parse(modelKey) as IosHeaderModel;
    const crumbs = model.crumbs.map((c, i) => ({ label: c.label, ...(c.accessibilityLabel ? { accessibilityLabel: c.accessibilityLabel } : {}), ...(c.pressable ? { onPress: () => press(`crumb:${i}`) } : {}) }));
    return {
      ...(JSON.parse(optionsKey) as object),
      headerTitle:
        model.titleView === 'breadcrumb'
          ? () => <BreadcrumbTitle breadcrumb={crumbs} title={model.title} />
          : model.titleView === 'inline'
            ? () => <InlineTitle title={model.title} scroll={scroll} />
            : undefined,
    };
  }, [modelKey, optionsKey, press, scroll]);
  // A link that resets the stack onto an already-mounted screen (a module root reached by `generatorai:///settings`)
  // gives the route fresh options while <Stack.Screen> keeps its memoized ones, so the bar fell back to the route
  // name ("settings/index", "index"). Re-apply on focus; it is the same value, so nothing re-renders in a loop.
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      navigation.setOptions(options);
    }, [navigation, options]),
  );
  const left = useMemo(() => {
    const model = JSON.parse(modelKey) as IosHeaderModel;
    return model.left.map((item) =>
      item.text ? (
        <Stack.Toolbar.Button key={item.target} onPress={() => press(item.target)}>
          {item.text}
        </Stack.Toolbar.Button>
      ) : (
        <Stack.Toolbar.Button key={item.target} icon={item.icon as SFSymbol} accessibilityLabel={item.label} selected={item.selected} onPress={() => press(item.target)} />
      ),
    );
  }, [modelKey, press]);
  const right = useMemo(() => {
    const model = JSON.parse(modelKey) as IosHeaderModel;
    return model.right.map((item) => {
      switch (item.kind) {
        case 'menu':
          return (
            <Stack.Toolbar.Menu key={item.target} icon={sf(item.icon)} accessibilityLabel={item.label}>
              {item.items.map((m) => (
                <Stack.Toolbar.MenuAction key={m.target} icon={m.icon ? (sfSymbolFor(m.icon) as SFSymbol | undefined) : undefined} destructive={m.destructive} disabled={m.disabled} isOn={m.checked} onPress={() => press(m.target)}>
                  {m.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          );
        case 'button':
          return <Stack.Toolbar.Button key={item.target} icon={sf(item.icon)} accessibilityLabel={item.label} selected={item.selected} onPress={() => press(item.target)} />;
        case 'pane':
          return (
            <Stack.Toolbar.Button key="pane" icon="sidebar.right" accessibilityLabel={item.label} selected={item.open} onPress={() => press('pane')}>
              {item.count > 0 ? <Stack.Toolbar.Badge>{String(item.count)}</Stack.Toolbar.Badge> : null}
            </Stack.Toolbar.Button>
          );
        case 'overflow':
          return (
            <Stack.Toolbar.Menu key="overflow" icon="ellipsis" accessibilityLabel="More options">
              {item.items.map((a) => (
                <Stack.Toolbar.MenuAction key={a.target} icon={sf(a.icon)} destructive={a.destructive} onPress={() => press(a.target)}>
                  {a.label}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          );
        case 'primary':
          return (
            <Stack.Toolbar.Button key="primary" variant="prominent" disabled={item.disabled} onPress={() => press('primary')}>
              {item.label}
            </Stack.Toolbar.Button>
          );
      }
    });
  }, [modelKey, press]);
  const detail = role === 'detail' || role === 'workspace';
  return (
    <>
      <Stack.Screen options={options} />
      <Stack.Toolbar placement="left">{left}</Stack.Toolbar>
      <Stack.Toolbar placement="right">{right}</Stack.Toolbar>
      {subtitle ? (
        <View className="px-gutter-title pb-2">
          {/* A plain-string subtitle is set as a footnote (RN renders strings only inside <Text>). */}
          {typeof subtitle === 'string' ? <Text role="footnote" tone="fg-2">{subtitle}</Text> : subtitle}
        </View>
      ) : null}
      {detail && status ? <StatusLine status={status} /> : null}
    </>
  );
}
