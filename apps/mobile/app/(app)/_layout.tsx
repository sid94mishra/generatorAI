// The (app) shell (04 §1.2, MD-18): AppShell (sidebar, main column, connection banner) around one native Stack that
// carries every screen. Presentation options for every route live here (04 §1.1 rule 2), from
// `ui/platform/presentation` (MD-21). Until M5-04 replaces it, legacy details keep the JS stack header (MD-138).
import React, { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';

import { AppShell } from '../../src/blocks/shell/AppShell';
import { StackHeader, type StackHeaderProps } from '../../src/navigation/StackHeader';
import { parentHref } from '../../src/blocks/shell/parentHref';
import { routePath } from '../../src/blocks/shell/routePath';
import { detailOptions, moduleRootOptions, paletteOptions, sheetOptions } from '../../src/ui/platform';
import { IconButton } from '../../src/ui/primitives/IconButton';
import { useTheme } from '../../src/theme/ThemeProvider';

const MODULE_ROOTS = ['index', 'chats/index', 'projects/index', 'agents/index', 'workflows/index', 'automations/index', 'scripts/index'];
const SHEETS = ['chats/[id]/gate/[interactionId]', 'chats/[id]/plan/[planId]', 'scope-request'];
/** Screens built on the kit Header (native on iOS, the JS bar on Android): no legacy JS stack header. */
const KIT_HEADER = ['needs-you'];
/** Legacy screens that draw their own header (settings, chat, run, the attention list). */
const OWN_HEADER = [
    'chats/[id]/index',
  'workflows/[id]/runs/[runId]/index',
  'settings/index', 'settings/about', 'settings/accessibility', 'settings/appearance', 'settings/audio', 'settings/capabilities',
  'settings/diagnostics', 'settings/extensions', 'settings/notifications', 'settings/providers', 'settings/security',
  'settings/source-control', 'settings/tools',
];
/** Legacy details that use the navigator header, with the title they start with (screens may refine it). */
const STACK_HEADER: Record<string, string> = {
  'workflows/[id]/index': 'Workflow',
  'workflows/[id]/runs/[runId]/stages/[stageRunId]': 'Stage',
  'scripts/[id]/index': 'Script',
  'automations/[id]/index': 'Automation',
  'projects/[id]/index': 'Project',
  'projects/[id]/[tab]': 'Project',
  'projects/[id]/pull-requests': 'Pull requests',
  'projects/[id]/codebases/[cid]/index': 'Codebase',
  'projects/[id]/codebases/[cid]/files': 'Files',
  'projects/[id]/codebases/[cid]/file': 'File',
  'projects/[id]/codebases/[cid]/pull-requests/[number]': 'Pull request',
  'changes/[workspaceId]/index': 'Changes',
  'changes/[workspaceId]/file': 'Diff',
  'terminal/[workspaceId]': 'Terminal',
};

type Href = Parameters<typeof router.replace>[0];

function HeaderBack({ name, params }: { name: string; params: unknown }): React.ReactElement {
  return (
    <IconButton
      label="Back"
      icon="back"
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace((parentHref(routePath(name, params)) ?? '/') as Href);
      }}
    />
  );
}

export default function AppLayout(): React.ReactElement {
  const { legacyColors: colors } = useTheme();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Android Back on a screen with no history (a link, a notification) walks up the IA instead of closing the
  // app; a module root goes Home (MD-88). Registered once, before any screen, so screen handlers run first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) return false;
      const parent = parentHref(pathnameRef.current);
      if (!parent) return false;
      router.replace(parent as Href);
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <AppShell>
          <Stack
            screenOptions={{
              header: (props) => <StackHeader {...(props as unknown as StackHeaderProps)} />,
              contentStyle: { backgroundColor: colors.background },
              ...detailOptions,
              // Off-screen screens stop re-rendering during a chat stream.
              freezeOnBlur: true,
            }}
          >
            {MODULE_ROOTS.map((name) => (
              <Stack.Screen key={name} name={name} options={{ ...moduleRootOptions, headerShown: false }} />
            ))}
            {SHEETS.map((name) => (
              <Stack.Screen key={name} name={name} options={sheetOptions('approval')} />
            ))}
            <Stack.Screen name="search" options={paletteOptions} />
            {KIT_HEADER.map((name) => (
              <Stack.Screen key={name} name={name} options={{ header: undefined }} />
            ))}
            {OWN_HEADER.map((name) => (
              <Stack.Screen key={name} name={name} options={{ headerShown: false }} />
            ))}
            {Object.entries(STACK_HEADER).map(([name, title]) => (
              <Stack.Screen
                key={name}
                name={name}
                options={({ route }) => ({ title, headerLeft: () => <HeaderBack name={name} params={route.params} /> })}
              />
            ))}
          </Stack>
    </AppShell>
  );
}
