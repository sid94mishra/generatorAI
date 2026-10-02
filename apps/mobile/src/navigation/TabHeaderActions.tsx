// ────────────────────────────────────────────────────────────────
// TabHeaderActions — the trailing actions of every tab's compact header.
//
//   Inbox bell   → `/needs-you`, with a count badge when something waits.
//                  It is the one entry point to the approvals sheet that is
//                  always on screen; the old floating "N waiting" strip only
//                  existed while the count was non-zero and fought the FAB
//                  for the same strip of screen.
//   Settings     → `/settings`.
//   Search       → `/search` (leading) — find any chat, run, workflow,
//                  project, automation or agent from any tab.
//
// Screens may pass extra actions (`children`) which render after search and
// before the bell.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, BellRing, Search } from 'lucide-react-native';

import { IconButton } from '../components/ui/Button';
import { MAX_SCALE } from '../components/ui/accessibility';
import { useTheme } from '../theme/ThemeProvider';
import { needsYouCount, useActivity } from '../features/home/queries';
import { NEEDS_YOU_HREF, SEARCH_HREF } from '../blocks/shell/hrefs';

function needsYouLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+ waiting for you' : `${count} waiting for you`;
}

export function InboxButton({ count: countProp }: { count?: number }): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const { operations } = useActivity();
  const count = countProp ?? needsYouCount(operations);
  const label = needsYouLabel(count);
  const badge = count > 99 ? '99+' : String(count);

  return (
    <View>
      <IconButton
        accessibilityLabel={label ? `Approvals, ${label}` : 'Approvals'}
        accessibilityHint="Opens everything waiting on a decision"
        testID="header-inbox"
        icon={
          count > 0 ? (
            <BellRing size={20} color={colors.warning} />
          ) : (
            <Bell size={20} color={colors.foreground} />
          )
        }
        onPress={() => router.push(NEEDS_YOU_HREF)}
      />
      {count > 0 ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute right-0.5 top-0.5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-warning px-1"
          style={{ height: 20 }}
        >
          <Text
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            className="text-xs font-bold"
            style={{ color: colors.background, lineHeight: 14 }}
          >
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function SearchButton(): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  return (
    <IconButton
      accessibilityLabel="Search"
      accessibilityHint="Finds chats, runs, workflows, projects, automations and agents"
      testID="header-search"
      icon={<Search size={20} color={colors.foreground} />}
      onPress={() => router.push(SEARCH_HREF)}
    />
  );
}

export function TabHeaderActions({ children }: { children?: React.ReactNode }): React.ReactElement {
  return (
    <View className="flex-row items-center">
      <SearchButton />
      {children}
      <InboxButton />
    </View>
  );
}
