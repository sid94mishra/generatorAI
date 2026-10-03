// Must stay the first import: freezes the clock and motion before any story module evaluates (VRT, 08 §4.6).
import './vrtMode';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { LiteUI } from '@storybook/react-native-ui-lite';
import { view } from './storybook.requires';

export default function StorybookScreen(): React.ReactElement {
  return __DEV__ && process.env.EXPO_PUBLIC_STORYBOOK === '1' ? <DevelopmentStories /> : <Redirect href="/" />;
}
function DevelopmentStories(): React.ReactElement {
  const params = useLocalSearchParams<{ story?: string; theme?: string; mode?: string; accent?: string }>();
  const story = params.story?.includes('--') ? params.story as `${string}--${string}` : undefined;
  const Canvas = useMemo(() => view.getStorybookUI({
    CustomUIComponent: LiteUI,
    initialSelection: story ?? 'ui-primitives-button--all-variants',
    shouldPersistSelection: false,
    onDeviceUI: !story,
  }), [story]);
  const captureKey = `${story}:${params.theme}:${params.mode}:${params.accent}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    // Story selection and globals travel through Storybook's public channel.
    const channel = view._channel;
    let first = 0;
    let second = 0;
    const rendered = () => {
      // Current fixtures use platform fonts (already loaded). M3's font loader
      // must resolve before a kit story emits storyRendered.
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setReadyKey(captureKey)); });
    };
    channel.on('storyRendered', rendered);
    channel.emit('updateGlobals', { globals: { theme: params.theme ?? 'instrument', mode: params.mode ?? 'dark', accent: params.accent ?? 'ink' } });
    return () => {
      channel.off('storyRendered', rendered);
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [params.theme, params.mode, params.accent, story, captureKey]);
  return <View className="flex-1" testID="vrt-root"><Canvas />{readyKey === captureKey ? <View testID="vrt-ready" /> : null}</View>;
}
