// Safe-area insets for the kit: the provider's values, or zeros where no SafeAreaProvider is mounted (Jest, stories
// rendered outside the app shell), so kit parts never throw for a missing provider.
import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}
