// What the connection screens say when the trust layer knows why a server cannot be used (MV-44, MD-202). Pure.
import type { ConnectionProblem } from '../transport/trust';

export interface ConnectionProblemCopy {
  title: string;
  body: string;
  /** `pair`: only pairing again helps; `settings`: an OS switch, then retry. */
  action: 'pair' | 'settings';
}

/** `localNetworkSetting` is the platform's path to the switch (`nouns().localNetworkSetting`). */
export function connectionProblemCopy(problem: ConnectionProblem, localNetworkSetting: string): ConnectionProblemCopy {
  switch (problem) {
    case 'certificate-changed':
      return {
        title: 'This server’s identity changed — pair again',
        body:
          'Its certificate is not the one this device trusted when it paired, so the connection was refused. That happens when ' +
          'GeneratorAI was reinstalled on your computer — or when something on this network is impersonating it. Pair again ' +
          'only if you expected this.',
        action: 'pair',
      };
    case 'insecure-endpoint':
      return {
        title: 'Pair again for an encrypted connection',
        body:
          'This device was paired over plain HTTP, which GeneratorAI no longer uses. Update GeneratorAI on your computer if ' +
          'needed, then pair again with a new code from Settings › Security & devices.',
        action: 'pair',
      };
    case 'local-network-denied':
      return {
        title: 'Allow Local Network access',
        body: `GeneratorAI needs access to your local network to reach your server. Turn it on in ${localNetworkSetting}, then try again.`,
        action: 'settings',
      };
  }
}
