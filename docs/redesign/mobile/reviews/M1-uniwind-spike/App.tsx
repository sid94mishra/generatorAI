import './global.css';
import { Activity, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaListener, SafeAreaProvider } from 'react-native-safe-area-context';
import { ScopedTheme, Uniwind, useResolveClassNames, useUniwind, withUniwind } from 'uniwind';

const AnimatedView = withUniwind(Animated.View);

function Btn({ label, onPress, id }: { label: string; onPress: () => void; id: string }) {
  return (
    <Pressable testID={id} onPress={onPress} className="rounded-control border border-line bg-raised px-3 py-2">
      <Text className="text-ui text-fg">{label}</Text>
    </Pressable>
  );
}

function Resolved({ label, classes }: { label: string; classes: string }) {
  const style = useResolveClassNames(classes);
  return (
    <Text testID={`resolved-${label}`} className="font-mono text-micro text-fg-2">
      {label}: {JSON.stringify(style)}
    </Text>
  );
}

function Pulse() {
  const w = useSharedValue(40);
  useEffect(() => {
    w.value = withRepeat(withTiming(200, { duration: 900 }), -1, true);
  }, [w]);
  const animated = useAnimatedStyle(() => ({ width: w.value }));
  return <AnimatedView className="h-3 rounded-card bg-accent" style={animated} />;
}

function Swatches() {
  return (
    <View className="flex-row gap-2">
      {['bg-ground', 'bg-surface', 'bg-raised', 'bg-accent', 'bg-run', 'bg-ok', 'bg-warn', 'bg-err'].map((c) => (
        <View key={c} className={`h-8 w-8 rounded-badge border border-line ${c}`} />
      ))}
    </View>
  );
}

export default function App() {
  const { theme } = useUniwind();
  const mounts = useRef(0);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    mounts.current += 1;
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaListener onChange={({ insets }) => Uniwind.updateInsets(insets)}>
        <ScrollView className="flex-1 bg-ground" contentContainerClassName="gap-3 p-4 pt-safe">
          {/* 1 — boots, bg-surface paints */}
          <View testID="check1" className="rounded-card bg-surface p-3">
            <Text className="text-title text-fg">Uniwind spike · {Platform.OS} · theme {theme} · mounts {mounts.current}</Text>
          </View>

          {/* 2 — theme switch without remount */}
          <View className="flex-row flex-wrap gap-2">
            <Btn id="t-instrument-dark" label="instrument-dark" onPress={() => Uniwind.setTheme('instrument-dark')} />
            <Btn id="t-github-light" label="github-light" onPress={() => Uniwind.setTheme('github-light')} />
            <Btn id="t-solarized-light" label="solarized-light" onPress={() => Uniwind.setTheme('solarized-light')} />
          </View>
          <Swatches />
          <Resolved label="surface" classes="bg-surface text-fg" />

          {/* 3 / 6 — platform geometry and text metrics */}
          <View className="rounded-card border border-line bg-surface p-3">
            <Text className="text-body text-fg">text-body sample</Text>
            <Text className="text-display text-fg">Display</Text>
          </View>
          <Resolved label="body" classes="text-body rounded-card" />
          <Resolved label="display" classes="text-display" />
          <Resolved label="title" classes="text-title" />
          {/* 9 — platform class prefixes (Gate A, PR #686) */}
          <Text className="text-ui ios:text-ok android:text-warn">platform class: ok on iOS, warn on Android</Text>
          <Resolved label="platformClass" classes="ios:text-ok android:text-warn" />

          {/* 4 — accent override per theme */}
          <View className="flex-row flex-wrap gap-2">
            <Btn
              id="a-active"
              label="accent→pink (active)"
              onPress={() => Uniwind.updateCSSVariables(Uniwind.currentTheme, { '--gai-accent': '#ff2d95' })}
            />
            <Btn
              id="a-inactive"
              label="accent→lime on github-dark, then switch"
              onPress={() => {
                Uniwind.updateCSSVariables('github-dark', { '--gai-accent': '#9be22d' });
                Uniwind.setTheme('github-dark');
              }}
            />
          </View>
          <Resolved label="accent" classes="bg-accent" />

          {/* 5 — ScopedTheme preview */}
          <ScopedTheme theme="solarized-light">
            <View testID="scoped" className="rounded-card border border-line bg-surface p-3">
              <Text className="text-ui text-fg">ScopedTheme solarized-light preview</Text>
              <Swatches />
            </View>
          </ScopedTheme>

          {/* 7 — shadows, tabular numbers, mono */}
          <View className="flex-row gap-4 p-2">
            <View className="h-12 w-24 rounded-card bg-raised shadow-pop" />
            <View className="h-12 w-24 rounded-card bg-raised shadow-float" />
          </View>
          <Text className="text-ui text-fg tabular-nums">tabular 1111 / 8888</Text>
          <Text className="font-mono text-ui font-semibold text-fg">mono semibold 0123</Text>
          <Resolved label="shadow" classes="shadow-pop" />

          {/* 8 — colour props via *ClassName */}
          <TextInput
            placeholder="placeholder in fg-3"
            placeholderTextColorClassName="accent-fg-3"
            selectionColorClassName="accent-accent"
            cursorColorClassName="accent-run"
            className="h-control rounded-control border border-line px-3 text-ui text-fg"
          />
          <ActivityIndicator colorClassName="accent-run" />

          {/* 10 — Activity hidden while the theme changes */}
          <Btn id="activity" label={hidden ? 'show hidden panel' : 'hide panel'} onPress={() => setHidden((h) => !h)} />
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <View testID="activity-panel" className="rounded-card bg-surface p-3">
              <Text className="text-ui text-fg">Activity panel</Text>
              <Swatches />
            </View>
          </Activity>

          {/* 11 — Reanimated through withUniwind */}
          <Pulse />
        </ScrollView>
      </SafeAreaListener>
    </SafeAreaProvider>
  );
}
