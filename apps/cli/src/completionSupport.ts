// Re-exports used by the completion helper.
//
// Kept in one shim so `complete.ts` has a single import line and the theme
// lookup can degrade: `design-tokens` is optional at completion time, and a
// missing theme list must not make Tab print a stack trace.

export {
  ConnectionManager,
  createCliClient,
  DEFAULT_KEYMAP,
  readUserConfig,
  type CompletionSource,
} from '@generatorai/cli-core';

import { terminalThemeIds } from '@generatorai/design-tokens';

export function terminalThemeIdsSafe(): Array<{ id: string; label: string }> {
  try {
    return terminalThemeIds();
  } catch {
    return [];
  }
}
