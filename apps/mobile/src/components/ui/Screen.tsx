// ────────────────────────────────────────────────────────────────
// Screen — the scaffold the legacy screens are built on, inside the M5 shell.
//
// The header is the kit Header (ML-02, MD-86) in the role the screen implies
// (MD-141): `back` makes a detail (Back + breadcrumb), otherwise a module root
// with the sidebar toggle. iOS draws the native header (opaque: the legacy
// body does not adjust its insets under a transparent bar), Android the M3
// bar. Header actions follow the max-actions rule; "New" is the floating
// NewAction, never a header item (MD-18). Each screen moves to the kit Screen
// (ML-01) when M6/M7 rewrite it.
//
// Kept from the earlier scaffold: safe-area handling, search under the
// header, pull-to-refresh, the reading column on wide windows, and Back that
// never strands a screen opened by a link (it walks up the IA, MD-88).
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';

import { SearchField } from './Form';
import { useTheme } from '../../theme/ThemeProvider';
import { usePullToRefresh } from './usePullToRefresh';
import { READABLE_MAX_WIDTH } from './windowInsets';
import { Header, type HeaderAction } from '../../ui/native/router/Header';
import { NewAction } from '../../ui/layout/NewAction';
import type { NewActionProps } from '../../ui/layout/NewAction/NewAction.types';
import { Text as KitText } from '../../ui/primitives/Text';
import { pathCrumbs } from '../../blocks/shell/crumbs';
import { useBreadcrumb, useHeaderBack, type CrumbInput } from '../../blocks/shell/useHeaderNav';
import { useSidebarToggle } from '../../blocks/shell/useSidebarToggle';

/**
 * iPad / landscape: content shares one centred column. Phones in portrait are
 * narrower than the cap, so this is a no-op there.
 */
const COLUMN = { width: '100%', maxWidth: READABLE_MAX_WIDTH, alignSelf: 'center' } as const;

/** Room a list leaves under its last row for the floating NewAction (52 + 6 + gap). */
const FAB_CLEARANCE = 72;

const noop = (): void => undefined;

/**
 * Leave the current screen without stranding the user.
 *
 * A deep link, a notification tap or a cold start on a detail route all
 * produce a stack with nothing behind them.
 */
export function goBack(fallback: Parameters<typeof router.replace>[0] = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

export interface ScreenSearch {
  value: string;
  /** v2 name. */
  onChange?: (next: string) => void;
  /** v1 name; either works. */
  onChangeText?: (next: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

export function Screen({
  title,
  subtitle,
  actions,
  breadcrumb,
  largeTitle,
  sidebarToggle = true,
  back = false,
  backFallback,
  onBack,
  onRefresh,
  refreshing = false,
  search,
  children,
  scroll = true,
  contentClassName = '',
  bottomInset = 0,
  newAction,
}: {
  title?: string;
  subtitle?: string;
  /** Header actions (06 §2.4: platform max, then the overflow menu; destructive always in it). */
  actions?: ReadonlyArray<HeaderAction>;
  /** Detail screens: real ancestors (default: the IA parent chain of the path). */
  breadcrumb?: ReadonlyArray<CrumbInput>;
  /** Home only on Android (MD-94); iOS module roots default to the native large title. */
  largeTitle?: boolean;
  /** Module roots show the sidebar toggle; public screens (pairing) pass false. */
  sidebarToggle?: boolean;
  back?: boolean;
  backFallback?: Parameters<typeof router.replace>[0];
  /** Replace the default Back; for a sheet-like screen that confirms first. */
  onBack?: () => void;
  /** May return a promise; the spinner then ends when it settles. */
  onRefresh?: () => unknown;
  /** Whether the data is fetching. The spinner only shows for a USER pull. */
  refreshing?: boolean;
  /** A search field under the header. */
  search?: ScreenSearch;
  children: React.ReactNode;
  /** Set when the screen supplies its own scroller (a virtualised list). */
  scroll?: boolean;
  contentClassName?: string;
  /** Extra bottom clearance. */
  bottomInset?: number;
  /** The module's floating "New …" (ML-09). */
  newAction?: NewActionProps;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { legacyColors: colors } = useTheme();
  const pull = usePullToRefresh(onRefresh ?? noop, refreshing);
  const toggle = useSidebarToggle();
  const headerBack = useHeaderBack();
  // The screen's own path, captured at mount: the global pathname moves on when another screen is pushed on top.
  const [ownPath] = useState(usePathname());
  const crumbInput = useMemo(() => breadcrumb ?? (back ? pathCrumbs(ownPath) : NO_CRUMBS), [breadcrumb, back, ownPath]);
  const crumbs = useBreadcrumb(crumbInput);

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else if (backFallback && !router.canGoBack()) router.replace(backFallback);
    else headerBack();
  }, [onBack, backFallback, headerBack]);

  const onSearchChange = search?.onChange ?? search?.onChangeText;
  const searchNode =
    search && onSearchChange ? (
      <SearchField
        value={search.value}
        onChangeText={onSearchChange}
        placeholder={search.placeholder ?? 'Search'}
        autoFocus={search.autoFocus ?? false}
        {...(search.onSubmit ? { onSubmit: search.onSubmit } : {})}
      />
    ) : null;

  const roleProps = back ? { onBack: handleBack, breadcrumb: crumbs } : sidebarToggle ? toggle : {};
  const header = title ? (
    <Header
      role={back ? 'detail' : 'top'}
      title={title}
      opaque
      {...(subtitle ? { subtitle: <KitText role="footnote" tone="fg-2">{subtitle}</KitText> } : {})}
      {...(actions ? { actions } : {})}
      {...(largeTitle !== undefined ? { largeTitle } : {})}
      {...roleProps}
    />
  ) : null;
  const accessory = newAction ? FAB_CLEARANCE : 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {header}
      {searchNode ? (
        <View style={COLUMN} className="px-4 pb-2 pt-1">
          {searchNode}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[COLUMN, { padding: 16, paddingBottom: insets.bottom + 24 + bottomInset + accessory, gap: 12 }]}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors['muted-foreground']} colors={[colors.primary ?? '']} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 ${contentClassName}`} style={COLUMN}>
          {children}
        </View>
      )}
      {newAction ? <NewAction {...newAction} /> : null}
    </View>
  );
}

const NO_CRUMBS: CrumbInput[] = [];

/** Non-animated scroller for nested content that must not own a header. */
export function PlainScroll({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  onRefresh?: () => unknown;
  /** Whether data is fetching; the spinner shows only for a user pull. */
  refreshing?: boolean;
}): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const pull = usePullToRefresh(onRefresh ?? noop, refreshing);
  return (
    <ScrollView
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={colors['muted-foreground']} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
