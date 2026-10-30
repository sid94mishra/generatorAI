// The (app) shell (04 §1.2, MD-18): AppShell (sidebar, workspace pane, connection banner) around one native Stack
// that carries every screen. Presentation options for every route live here (04 §1.1 rule 2), from
// `ui/platform/presentation` (MD-21). Every screen draws the kit Header itself (native on iOS, the M3 bar on
// Android); the last legacy navigator headers (MD-141) went with the M8 run screens.
import React, { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';

import { AppShell } from '../../src/blocks/shell/AppShell';
import { parentHref } from '../../src/blocks/shell/parentHref';
import { EDITOR_ROUTES as EDITORS, LARGE_SHEET_ROUTES as LARGE_SHEETS, PALETTE_ROUTE, PICKER_ROUTE, SHEET_ROUTES as SHEETS } from '../../src/services/navigation/presentedRoutes';
import { fullScreenModalOptions, moduleRootOptions, paletteOptions, sheetOptions, useStackScreenOptions } from '../../src/ui/platform';

const MODULE_ROOTS = ['index', 'chats/index', 'projects/index', 'agents/index', 'workflows/index', 'automations/index', 'scripts/index', 'settings/index'];

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
        <Stack.Screen name={PALETTE_ROUTE} options={paletteOptions} />
        <Stack.Screen name={PICKER_ROUTE} options={sheetOptions('picker')} />
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
