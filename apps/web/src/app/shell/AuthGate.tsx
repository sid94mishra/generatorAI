// ────────────────────────────────────────────────────────────────
// AuthGate — decides whether the SPA may render at all (P5-11; split from
// `components/AuthGate.tsx`: this file is the gate's logic, `features/pairing`
// is the view).
//
// Three outcomes (`hooks/authQueries.ts` `resolveGateOutcome`, unit-tested):
//   * 'app'     authenticated (device-paired, legacy shared key, or a server
//               running in dev-only unauthenticated loopback mode)
//   * 'pairing' unpaired / revoked → PairingGate (features/pairing)
//   * 'loading' still initialising, or desktop is silently auto-pairing
// ────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { PairingGate } from '@/features/pairing/PairingGate.js';
import { useAuthGate } from '@/hooks/authQueries.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, reachable, outcome } = useAuthGate();

  if (outcome === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-ground">
        <Spinner size={16} className="text-fg-3" />
      </div>
    );
  }

  if (outcome === 'pairing') {
    return <PairingGate state={state} endpoint={window.location.origin} reachable={reachable} />;
  }

  return <>{children}</>;
}
