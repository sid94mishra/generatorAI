// ────────────────────────────────────────────────────────────────
// AppDrawer — the app's primary navigation.
//
// Replaces the bottom tab bar. Agentic chat clients converged on this shape
// for a reason: the conversation needs the full height of the phone, and the
// destinations outgrow a four-slot tab bar. Like the desktop sidebar it is
// navigation only, with no inline entity lists. It carries:
//
//   • search,
//   • every destination the desktop sidebar has, in the same order,
//   • the host this phone is paired with, approvals and Settings.
//
// It floats over the content like the right-hand workbench panel, so both
// side panels share one material (Liquid Glass on iOS 26+).
// ────────────────────────────────────────────────────────────────

import React, { useCallback } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  BellRing,
  Bot,
  FileCode2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react-native';

import { useActivity, needsYouCount } from '../../api/useActivity';
import { useAuth } from '../../auth/AuthProvider';
import { SidePanelHost } from '../../components/ui/SidePanel';
import { Touchable } from '../../components/ui/Touchable';
import { IconButton } from '../../components/ui/Button';
import { MAX_SCALE } from '../../components/ui/accessibility';
import { BrandMark } from '../../components/brand/BrandMark';
import { describeSessionTransport } from '../../components/chat/sessionTransport';
import { useStreamHealth } from '../../stream/streamHealth';
import { useTheme } from '../../theme/ThemeProvider';
import { APPROVALS_ROUTE, SEARCH_ROUTE } from '../routes';
import { scrollActiveToTop } from '../scrollToTop';
import { SHELL_SECTIONS, drawerAvailable, sectionForPath, type ShellSection } from './sections';
import { useShellStore } from './shellStore';

const ICONS: Record<ShellSection, LucideIcon> = {
  home: LayoutDashboard,
  chats: MessageSquare,
  projects: FolderKanban,
  agents: Bot,
  workflows: GitBranch,
  automations: RefreshCw,
  scripts: FileCode2,
};

type Href = Parameters<typeof router.navigate>[0];

/**
 * Leave whatever is pushed and land on a shell destination.
 *
 * Pop first, switch tab on the next frame. The tab navigator sits in a stack
 * screen with `freezeOnBlur`; switching tabs in the same dispatch as the pop
 * rendered the new tab while that screen was still frozen, and from a pushed
 * screen on another tab (Home, Search, a chat, then Chats) the new tab never
 * appeared: the phone showed an empty screen.
 */
function goToSection(href: string): void {
  if (!router.canDismiss()) {
    router.navigate(href as Href);
    return;
  }
  router.dismissAll();
  requestAnimationFrame(() => router.navigate(href as Href));
}

export function AppDrawerHost({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const open = useShellStore((s) => s.drawerOpen);
  const setOpen = useShellStore((s) => s.setDrawerOpen);
  const { state } = useAuth();
  const available = state.status === 'authenticated' && drawerAvailable(pathname);

  // A route change always closes the drawer: the tap that caused it has been
  // answered, and a drawer left open over a new screen reads as a glitch.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  const renderPanel = useCallback(() => <DrawerContent />, []);

  return (
    <SidePanelHost
      side="left"
      presentation="overlay"
      open={open && available}
      onOpenChange={setOpen}
      swipeToOpen={available}
      renderPanel={renderPanel}
      accessibilityLabel="Navigation menu"
    >
      {children}
    </SidePanelHost>
  );
}

function DrawerContent(): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const work = useShellStore((s) => s.work);
  const projects = useShellStore((s) => s.projects);
  const close = useShellStore((s) => s.closeDrawer);
  const auth = useAuth();
  const activity = useActivity();
  const attention = needsYouCount(activity.operations);
  const streamConnection = useStreamHealth((s) => s.connection);
  const transport = describeSessionTransport(auth.transport, streamConnection);

  const active = sectionForPath(pathname, { work, projects });
  const toneColor =
    transport.tone === 'success'
      ? colors.success
      : transport.tone === 'warning'
        ? colors.warning
        : transport.tone === 'danger'
          ? colors.danger
          : colors['muted-foreground'];

  const header = (
    <View>
      <View className="flex-row items-center gap-2.5 px-4 pb-3" style={{ paddingTop: 10 }}>
        <BrandMark size={28} />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_SCALE.chrome}
          className="flex-1 text-lg font-bold text-foreground"
        >
          GeneratorAI
        </Text>
        <IconButton
          accessibilityLabel="Search"
          accessibilityHint="Finds chats, runs, workflows, projects, automations and agents"
          testID="drawer-search"
          icon={<Search size={20} color={colors.foreground} />}
          onPress={() => {
            close();
            router.push(SEARCH_ROUTE);
          }}
        />
      </View>

      <View className="px-3 pt-1">
        {SHELL_SECTIONS.map((section) => {
          const Icon = ICONS[section.id];
          const selected = section.id === active;
          const badge =
            section.id === 'home' && attention > 0
              ? attention > 99
                ? '99+'
                : String(attention)
              : null;
          return (
            <React.Fragment key={section.id}>
              <Touchable
                testID={`drawer-${section.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  badge ? `${section.label}, ${badge} waiting for you` : section.label
                }
                haptic="select"
                scale="none"
                onPress={() => {
                  close();
                  // Re-choosing the section already on screen scrolls it back
                  // to the top — what re-tapping the active tab used to do.
                  if (selected && !router.canDismiss()) scrollActiveToTop(section.scene);
                  else goToSection(section.href);
                }}
                className={`min-h-12 flex-row items-center gap-3.5 rounded-xl px-3.5 ${selected ? 'bg-sidebar-accent' : ''}`}
              >
                <Icon size={20} color={selected ? colors['sidebar-accent-foreground'] : colors['sidebar-foreground']} />
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_SCALE.control}
                  className={`flex-1 text-md ${selected ? 'font-semibold text-sidebar-accent-foreground' : 'font-medium text-foreground'}`}
                >
                  {section.label}
                </Text>
                {badge ? (
                  <View className="min-w-6 items-center rounded-full bg-warning px-1.5 py-0.5">
                    <Text maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs font-bold" style={{ color: colors.background }}>
                      {badge}
                    </Text>
                  </View>
                ) : null}
              </Touchable>
            </React.Fragment>
          );
        })}
      </View>

    </View>
  );

  return (
    <View className="flex-1" style={{ paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
      >
        {header}
      </ScrollView>

      <View
        className="flex-row items-center gap-1 border-t border-sidebar-border pl-4 pr-2"
        style={{ paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 4), paddingTop: 6 }}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: toneColor }} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-sm font-semibold text-foreground">
              {transport.label === 'LAN' ? 'Connected' : transport.label}
            </Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={MAX_SCALE.chrome} className="text-xs text-muted-foreground">
              {auth.transport.state === 'connected' ? auth.transport.endpoint.replace(/^https?:\/\//, '') : transport.detail}
            </Text>
          </View>
        </View>
        <View>
          <IconButton
            accessibilityLabel={attention > 0 ? `Approvals, ${attention} waiting for you` : 'Approvals'}
            testID="drawer-inbox"
            icon={
              attention > 0 ? (
                <BellRing size={20} color={colors.warning} />
              ) : (
                <Bell size={20} color={colors.foreground} />
              )
            }
            onPress={() => {
              close();
              router.push(APPROVALS_ROUTE);
            }}
          />
        </View>
        <IconButton
          accessibilityLabel="Settings"
          testID="drawer-settings"
          icon={<Settings size={20} color={colors.foreground} />}
          onPress={() => {
            close();
            router.push('/settings');
          }}
        />
      </View>
    </View>
  );
}
