// Safe-area insets for the kit (MD-24, 06 §1.1).
// - `useInsets()`: the nearest SafeAreaInsetsContext — inside the shell's main column the top / side insets read 0,
//   because the column pays them once (under it sit the header and the connection banner); zeros where no provider
//   is mounted (Jest, stories).
// - `useWindowInsets()`: the window's real insets, for surfaces that span the whole window (panels, modals,
//   imperative sheets). The shell provides them; outside the shell the nearest context is already the real one.
import React, { createContext, useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const WindowInsetsContext = createContext<EdgeInsets | null>(null);

export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}

export function WindowInsetsProvider({ insets, children }: { insets: EdgeInsets; children: React.ReactNode }): React.ReactElement {
  return React.createElement(WindowInsetsContext.Provider, { value: insets }, children);
}

export function useWindowInsets(): EdgeInsets {
  const window = useContext(WindowInsetsContext);
  const local = useInsets();
  return window ?? local;
}
