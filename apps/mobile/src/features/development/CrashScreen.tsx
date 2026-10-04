// `generatorai:///crash?kind=uncaught|caught` (dev builds only; reviews/F/crash.md): raises a JS error whose message
// carries a prompt, a home path and a query token, so the crash-report sink can verify the scrubbing (MD-197) on a
// platform where the Metro inspector cannot evaluate. `uncaught` throws from a timer (the global handler path, a
// LogBox redbox in dev), `caught` hands the error to reportCaughtError (the error-boundary path). Returns Home.
import React, { useEffect } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { reportCaughtError } from '../../services/native/crashReporting';

type Href = Parameters<typeof router.replace>[0];

const MESSAGE = 'Prompt: refactor /Users/alice/secret/app.ts?token=abc123 now';

export default function CrashScreen(): React.ReactElement | null {
  return __DEV__ ? <CrashTrigger /> : <Redirect href="/" />;
}

function CrashTrigger(): null {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  useEffect(() => {
    router.replace('/' as Href);
    if (kind === 'caught') {
      reportCaughtError(new Error(MESSAGE));
      return;
    }
    setTimeout(() => {
      throw new Error(MESSAGE);
    }, 500);
  }, [kind]);
  return null;
}
