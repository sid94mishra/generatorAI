// The (app) shell (04 §1.2, MD-18): AppShell (sidebar, workspace pane, connection banner) around one native Stack
// that carries every screen. Presentation options for every route live here (04 §1.1 rule 2), from
// `ui/platform/presentation` (MD-21). Every screen draws the kit Header itself (native on iOS, the M3 bar on
// Android); the last legacy navigator headers (MD-141) went with the M8 run screens.
import React, { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';

import { AppShell } from '../../src/blocks/shell/AppShell';
import { parentHref } from '../../src/blocks/shell/parentHref';
import { fullScreenModalOptions, moduleRootOptions, paletteOptions, sheetOptions, useStackScreenOptions } from '../../src/ui/platform';

const MODULE_ROOTS = ['index', 'chats/index', 'projects/index', 'agents/index', 'workflows/index', 'automations/index', 'scripts/index', 'settings/index'];
const SHEETS = ['chats/[id]/gate/[interactionId]', 'workflows/[id]/runs/[runId]/approval/[stageRunId]', 'scope-request'];
/** Full-screen modal editors (MD-21). */
const EDITORS = ['workflows/new', 'projects/new', 'projects/[id]/skills/[configId]/edit', 'agents/create', 'agents/[id]/edit', 'automations/new', 'automations/[id]/edit', 'settings/mcp/add'];
/** Route sheets at the large detent. */
const LARGE_SHEETS = ['workflows/[id]/run', 'chats/[id]/turn', 'chats/new', 'workspaces/[workspaceId]/commit', 'projects/[id]/add-codebase', 'agents/new', 'agents/import', 'automations/[id]/executions/[executionId]', 'scripts/[id]/run', 'pickers/model'];

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
        {LARGE_SHEETS.map((name) => (
          <Stack.Screen key={name} name={name} options={sheetOptions('large')} />
        ))}
        {EDITORS.map((name) => (
          <Stack.Screen key={name} name={name} options={fullScreenModalOptions} />
        ))}
      </Stack>
    </AppShell>
  );
}
