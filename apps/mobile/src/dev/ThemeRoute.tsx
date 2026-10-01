import React, { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { isKnownMode, isKnownTheme } from '@generatorai/design-tokens';
import { useTheme } from '../theme/ThemeProvider';
import { Screen } from '../components/ui/Screen';
import { ListRow } from '../components/ui/ListRow';

/** Native verification only; production never mounts preference-changing code. */
export default function ThemeRoute(): React.ReactElement {
  return __DEV__ ? <ThemeControl /> : <Redirect href="/" />;
}

function ThemeControl(): React.ReactElement | null {
  const params = useLocalSearchParams<{ theme?: string; mode?: string; accent?: string; inspect?: string }>();
  const { themeId, mode, accent, setThemeId, setMode, setAccent } = useTheme();
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (params.inspect === '1') return;
    if (isKnownTheme(params.theme)) setThemeId(params.theme!);
    if (isKnownMode(params.mode)) setMode(params.mode);
    if (typeof params.accent === 'string') setAccent(params.accent);
    setApplied(true);
  }, [params.theme, params.mode, params.accent, params.inspect, setThemeId, setMode, setAccent]);

  // Read the actual provider after relaunch: legacy appearance rows omit their
  // selected state. This does not change those rows or synthesize a selection.
  if (params.inspect === '1') {
    return (
      <Screen title="Theme inspection" back>
        <ListRow title={`Theme: ${themeId}`} />
        <ListRow title={`Mode: ${mode}`} />
        <ListRow title={`Accent: ${accent}`} />
      </Screen>
    );
  }
  return applied ? <Redirect href="/" /> : null;
}
