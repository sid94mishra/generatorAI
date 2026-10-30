// `generatorai:///theme?theme=<id>&mode=<mode>&accent=<id>` (dev builds only; 08 §5 theme characterization): applies
// the preference through the real provider and returns Home. `?inspect=1` shows what the provider holds after a
// relaunch (MD-103), so the Maestro flow can assert persistence without reading the Appearance rows.
import React, { useEffect } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { isKnownMode, isKnownTheme } from '@generatorai/design-tokens';

import { useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { useTheme } from '../../theme/ThemeProvider';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';

type Href = Parameters<typeof router.replace>[0];

export default function ThemeScreen(): React.ReactElement | null {
  return __DEV__ ? <ThemeControl /> : <Redirect href="/" />;
}

function ThemeControl(): React.ReactElement | null {
  const params = useLocalSearchParams<{ theme?: string; mode?: string; accent?: string; inspect?: string }>();
  const { themeId, mode, accent, setThemeId, setMode, setAccent } = useTheme();
  const inspect = params.inspect === '1';
  const onBack = useHeaderBack();
  useEffect(() => {
    if (inspect) return;
    if (isKnownTheme(params.theme)) setThemeId(params.theme!);
    if (isKnownMode(params.mode)) setMode(params.mode);
    if (typeof params.accent === 'string') setAccent(params.accent);
    router.replace('/' as Href);
  }, [inspect, params.theme, params.mode, params.accent, setThemeId, setMode, setAccent]);

  if (!inspect) return null;
  return (
    <Screen header={<Header role="detail" title="Theme inspection" onBack={onBack} />} background="grouped" testID="dev-theme-screen">
      <ListSection title="Provider">
        <ListRow kind="info" title={`Theme: ${themeId}`} />
        <ListRow kind="info" title={`Mode: ${mode}`} />
        <ListRow kind="info" title={`Accent: ${accent}`} />
      </ListSection>
    </Screen>
  );
}
