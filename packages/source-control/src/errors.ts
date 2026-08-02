// ────────────────────────────────────────────────────────────────
// Source-control errors
// ────────────────────────────────────────────────────────────────

import { GeneratorAIError } from '@generatorai/shared';

/** No source-control provider is configured/enabled for a host operation. */
export class ProviderNotConfiguredError extends GeneratorAIError {
  readonly category = 'validation' as const;
  readonly severity = 'warning' as const;
  readonly recoverable = true;
  constructor(message = 'No source-control provider is configured') {
    super(message, 'SCM_PROVIDER_NOT_CONFIGURED');
  }
}

/** A source-control host API call failed. */
export class SourceControlError extends GeneratorAIError {
  readonly category = 'network' as const;
  readonly severity = 'error' as const;
  readonly recoverable = true;
  constructor(message: string, cause?: Error) {
    super(message, 'SCM_ERROR', cause);
  }
}
