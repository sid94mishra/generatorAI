// Shared fakes for the source-control suites. Not a test file itself.

import type { ILogger, SourceControlSettings } from '@generatorai/shared';

export const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

export function settings(partial: Partial<SourceControlSettings> = {}): SourceControlSettings {
  return {
    accounts: [],
    defaultAccountId: null,
    generation: { provider: null, model: null },
    editor: { defaultEditor: null },
    defaultBase: null,
    ...partial,
  };
}
