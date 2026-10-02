// The (app) shell (04 §1.2, MD-18): AppShell (sidebar, workspace pane, connection banner) around one native Stack
// that carries every screen. Presentation options for every route live here (04 §1.1 rule 2), from
// `ui/platform/presentation` (MD-21). Screens draw the kit Header themselves (native on iOS, the M3 bar on Android);
// legacy details that still set navigator options get the kit-built LegacyStackHeader until M7/M8 (MD-141).
import React, { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';

import { AppShell } from '../../src/blocks/shell/AppShell';
import { LegacyStackHeader, type LegacyStackHeaderProps } from '../../src/blocks/shell/LegacyStackHeader';
import { parentHref } from '../../src/blocks/shell/parentHref';
import { moduleRootOptions, paletteOptions, sheetOptions, useStackScreenOptions } from '../../src/ui/platform';

const MODULE_ROOTS = ['index', 'chats/index', 'projects/index', 'agents/index', 'workflows/index', 'automations/index', 'scripts/index'];
const SHEETS = ['chats/[id]/gate/[interactionId]', 'chats/[id]/plan/[planId]', 'scope-request'];
/** Legacy details that set their title and trailing controls through navigator options. */
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

export default function AppLayout(): React.ReactElement {
  const screenOptions = useStackScreenOptions();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Android Back with no history (a link, a notification) walks up the IA instead of closing the app; a module
  // root other than Home goes Home (MD-88). Registered once, before any screen, so panels and screens run first.
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
      <Stack screenOptions={screenOptions}>
        {MODULE_ROOTS.map((name) => (
          <Stack.Screen key={name} name={name} options={moduleRootOptions} />
        ))}
        {SHEETS.map((name) => (
          <Stack.Screen key={name} name={name} options={sheetOptions('approval')} />
        ))}
        <Stack.Screen name="search" options={paletteOptions} />
        <Stack.Screen name="servers" options={sheetOptions('picker')} />
        {Object.entries(STACK_HEADER).map(([name, title]) => (
          <Stack.Screen
            key={name}
            name={name}
            options={{ title, headerShown: true, header: (props) => <LegacyStackHeader {...(props as unknown as LegacyStackHeaderProps)} /> }}
          />
        ))}
      </Stack>
    </AppShell>
  );
}
