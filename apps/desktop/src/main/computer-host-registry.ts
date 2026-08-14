// ────────────────────────────────────────────────────────────────
// computer-host-registry — process-wide accessor for the Computer Use host.
//
// Mirrors `browser-host.ts`'s accessor pattern so `index.ts` and `ipc.ts`
// share one instance. Constructed lazily because the driver must not be
// spawned until a workspace actually asks for it: starting it eagerly would
// trigger the macOS Accessibility prompt on first launch for every user,
// including those who never enable the feature.
// ────────────────────────────────────────────────────────────────

import { ComputerHost } from './computer-host';

let host: ComputerHost | null = null;

export function initComputerHost(options: {
  serverBaseUrl: string;
  ipcToken: string;
  log?: (message: string) => void;
}): ComputerHost {
  host = new ComputerHost(options);
  return host;
}

export function getComputerHost(): ComputerHost | null {
  return host;
}

export async function disposeComputerHost(): Promise<void> {
  const current = host;
  host = null;
  await current?.stop();
}
