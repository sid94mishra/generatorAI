// Opt-in crash reporting (MD-42, 06 §8.6, M10-06; MD-197). Off by default: nothing is initialised, sent or stored
// until the user enters a Sentry-compatible DSN (self-hosted Sentry, GlitchTip) in Settings › Diagnostics AND turns
// "Send crash reports" on. Then `@sentry/react-native` captures JS errors (and native crashes, `enableNative`) with
// the privacy scrubber of crashScrub.ts as `beforeSend` / `beforeBreadcrumb`; turning it off closes the client at once.
// Native crashes before JS starts are not captured (accepted in 06 §8.6). Symbol upload is a build concern
// (app.config.ts, only with the SENTRY_* environment).
import type * as SentryModule from '@sentry/react-native';
import Constants from 'expo-constants';

import { isValidDsn, scrubEvent } from './crashScrub';
import { RUNTIME_OS } from './runtimeOs';

export interface CrashReportingSettings {
  enabled: boolean;
  dsn: string;
}

let activeDsn: string | null = null;
let sentry: typeof SentryModule | null = null;

/** The SDK is evaluated only once the user opts in: with reporting off, launch never runs its ~1 MB of modules. */
function sdk(): typeof SentryModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred evaluation, see above
  sentry ??= require('@sentry/react-native') as typeof SentryModule;
  return sentry;
}

/** Starts, restarts (another DSN) or stops the reporter to match the settings. */
export function applyCrashReporting({ enabled, dsn }: CrashReportingSettings): void {
  const wanted = enabled && RUNTIME_OS !== 'web' && isValidDsn(dsn) ? dsn.trim() : null;
  if (wanted === activeDsn) return;
  if (activeDsn) void sdk().close().catch(() => undefined);
  activeDsn = null;
  if (!wanted) return;
  sdk().init({
    dsn: wanted,
    enableNative: true,
    sendDefaultPii: false,
    attachStacktrace: true,
    // Crashes only: no tracing, profiling, replay or session tracking.
    tracesSampleRate: 0,
    enableAutoSessionTracking: false,
    environment: __DEV__ ? 'development' : 'production',
    release: `dev.generatorai.app@${Constants.expoConfig?.version ?? '0.0.0'}`,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => ({ ...(crumb.type ? { type: crumb.type } : {}), ...(crumb.category ? { category: crumb.category } : {}), ...(crumb.level ? { level: crumb.level } : {}), ...(crumb.timestamp !== undefined ? { timestamp: crumb.timestamp } : {}) }),
  });
  activeDsn = wanted;
}

/** A render error a React error boundary caught (those never reach the global handler). No-op when off. */
export function reportCaughtError(error: unknown): void {
  if (!activeDsn) return;
  sdk().captureException(error);
}
