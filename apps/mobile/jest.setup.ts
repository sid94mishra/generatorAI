import 'react-native-gesture-handler/jestSetup';
import { setUpTests } from 'react-native-reanimated';

setUpTests();
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
// MMKV v4 uses its own in-memory implementation when JEST_WORKER_ID is set.
// Uniwind (resolved by Metro, absent in Jest): tests assert semantics and callbacks, not computed CSS.
// MMKV (Nitro) has no native module under Jest: kit tests that mount a ThemeProvider read preferences from
// an in-memory map. A test that asserts on prefs (ThemePreview.test) still mocks it itself.
jest.mock('./src/services/storage/prefs', () => {
  const store = new Map<string, string | boolean | number>();
  return {
    prefs: {
      getString: (k: string) => store.get(k) as string | undefined,
      setString: (k: string, v: string) => void store.set(k, v),
      getBoolean: (k: string, fallback = false) => (store.get(k) as boolean | undefined) ?? fallback,
      setBoolean: (k: string, v: boolean) => void store.set(k, v),
      getNumber: (k: string, fallback: number) => (store.get(k) as number | undefined) ?? fallback,
      setNumber: (k: string, v: number) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
      deletePrefix: (p: string) => [...store.keys()].forEach((k) => k.startsWith(p) && store.delete(k)),
    },
  };
});
// The Android ripple needs a native view (hotspotUpdate on the host ref), which the test renderer has not got.
jest.mock('react-native/Libraries/Components/Pressable/useAndroidRippleForView', () => ({ __esModule: true, default: () => null }));
// Native modules kit parts import at module level (Link → expo-web-browser, copy actions → expo-clipboard): kit tests
// render screens of parts that contain them, so they are mocked once here (a test may still mock them itself).
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)), getStringAsync: jest.fn(() => Promise.resolve('')) }));
