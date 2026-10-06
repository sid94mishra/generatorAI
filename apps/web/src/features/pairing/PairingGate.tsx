// ────────────────────────────────────────────────────────────────
// F-pairing-01 PairingGate (03-component-inventory-domain.md §3.10; L-03
// Gate; board Pairing; D-42 the server wins over the board's 6-box code).
//
// Card 420, centred full-window. Server address (mono, reachability dot) +
// the 12-character pairing code (3×4, PairingCodeInput) + informed consent
// (server id, scopes — "not drawn, keep") + device name + Connect. The
// board's "Scan QR from the desktop app" link is not rendered: no camera QR
// decode exists anywhere in this codebase (Settings ▸ Security only ever
// RENDERS a QR for a host to show, never reads one), so it would be a button
// that does nothing (D-36 no fake data).
//
// HTTPS (D-110): a browser creates its device key only in a secure context, so
// on a plain-HTTP page from another machine (the dev server without
// GENERATORAI_DEV_HTTPS — the packaged server redirects to https://) the gate
// says so instead of failing at Connect. On an https:// page from another
// machine it says where to compare the certificate fingerprint — on the
// server's screen, never a value this page received, which a man in the
// middle would simply relay.
//
// Replaces the view half of `components/AuthGate.tsx`; the gate logic
// (server-info probe, auto-pairing guard, which of the three outcomes
// applies) is `hooks/authQueries.ts`, driven from `app/shell/AuthGate.tsx`.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { isPairingCode } from '@generatorai/shared';
import {
  confirmPairing,
  consumePairingCodeFromUrl,
  defaultDeviceName,
  previewPairingConsent,
  type AuthState,
  type PairingConsent,
} from '@/hooks/authQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusDot } from '@/ui/primitives/StatusDot/StatusDot.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { PairingCodeInput } from '@/ui/patterns/PairingCodeInput/PairingCodeInput.js';
import { Gate } from '@/ui/templates/Gate/Gate.js';

/** Below this length an input cannot be a full offer blob, so it is still mid-paste. */
const MIN_OFFER_LENGTH = 64;

export interface PairingGateProps {
  state: AuthState;
  /** This origin's server address, shown in the "Server address" row. */
  endpoint: string;
  /** `undefined` while the first reachability probe of `endpoint` is in flight. */
  reachable: boolean | undefined;
}

export function PairingGate({ state, endpoint, reachable }: PairingGateProps) {
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState<PairingConsent | null>(null);
  /** True while a typed short code is being resolved against the host. */
  const [resolving, setResolving] = useState(false);
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Monotonic token that invalidates in-flight previews. Short codes resolve
  // over the network, so a user still typing can easily have two requests in
  // flight; without this the slower one can overwrite the newer result and
  // show consent for a code that is no longer in the box.
  const previewToken = useRef(0);

  const preview = useCallback((raw: string) => {
    const token = ++previewToken.current;
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed) {
      setConsent(null);
      setResolving(false);
      return;
    }
    // Wait for a complete code before asking the host about it, so every
    // keystroke of a 12-character code does not spend a throttle slot.
    if (!isPairingCode(trimmed) && trimmed.length < MIN_OFFER_LENGTH) {
      setConsent(null);
      setResolving(false);
      return;
    }

    setResolving(true);
    void previewPairingConsent(trimmed).then(
      (next) => {
        if (token !== previewToken.current) return;
        setConsent(next);
        setResolving(false);
      },
      (err: unknown) => {
        if (token !== previewToken.current) return;
        setConsent(null);
        setResolving(false);
        setError(err instanceof Error ? err.message : 'That pairing code is not valid.');
      },
    );
  }, []);

  // `?pair=` deep link / `/?pair=` — read once and strip it from the address
  // bar; the effect below then previews it exactly as a typed code.
  useEffect(() => {
    const fromUrl = consumePairingCodeFromUrl();
    if (fromUrl) setCode(fromUrl);
  }, []);

  useEffect(() => {
    if (code) preview(code);
  }, [code, preview]);

  const connect = useCallback(async () => {
    if (!consent) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPairing(consent, deviceName.trim() || defaultDeviceName());
      window.location.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [consent, deviceName]);

  const revoked = state.status === 'revoked';
  // `!== false`: an environment without the property (jsdom) is not a reason to block.
  const secureContext = window.isSecureContext !== false;
  const remoteHttps = window.location.protocol === 'https:' && !/^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  return (
    <Gate
      placement="window"
      data-testid="pairing-gate"
      icon="lock"
      tone={revoked ? 'err' : 'neutral'}
      title={revoked ? 'This device was revoked' : 'Connect to a GeneratorAI server'}
      description={
        revoked
          ? 'Its access was removed from the server. Pair again to continue.'
          : 'This browser is not paired yet. Pairing gives it its own key, which you can revoke at any time.'
      }
      note="Find the code in the desktop app under Settings › Security & devices › Pair a new device, or run generatorai device invite on the server."
    >
      {secureContext ? null : (
        <Callout tone="err" title="This page cannot pair over plain HTTP" data-testid="pairing-insecure-context">
          Browsers only create the key pairing needs on a secure page. Open this server&apos;s https:// address instead — the desktop app
          shows it under Settings › Security &amp; devices.
        </Callout>
      )}

      <Field label="Server address">
        <Input
          readOnly
          mono
          value={endpoint}
          trailing={
            reachable === undefined ? null : (
              <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-3">
                <StatusDot tone={reachable ? 'ok' : 'err'} size="sm" />
                {reachable ? 'Reachable' : 'Unreachable'}
              </span>
            )
          }
        />
      </Field>

      <Field label="Enter the pairing code shown on the server" error={error}>
        <PairingCodeInput value={code} onValueChange={setCode} invalid={Boolean(error)} disabled={busy} />
      </Field>

      {resolving ? (
        <p className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} />
          Checking this code…
        </p>
      ) : null}

      {consent ? (
        <div className="flex flex-col gap-3 rounded-card border border-line-soft bg-sunken p-3.5">
          <p className="text-small font-medium text-fg">You are about to connect to:</p>
          <KeyValueList
            labelWidth={92}
            items={[
              { label: 'Server', value: consent.serverName || 'GeneratorAI' },
              { label: 'Endpoint', value: consent.endpoint, mono: true },
              {
                label: 'Host identity',
                value: `${consent.serverId.slice(0, 8)}…${consent.serverId.slice(-8)}`,
                mono: true,
              },
            ]}
          />
          <div>
            <p className="mb-1.5 text-small text-fg-3">This device will be granted:</p>
            <div className="flex flex-wrap gap-1.5">
              {consent.requestedScopes.map((scope) => (
                <Chip key={scope} mono size="sm">
                  {scope}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {remoteHttps ? (
        <p className="text-small text-fg-3" data-testid="pairing-certificate-hint">
          Did your browser warn about this server&apos;s certificate? Check that the SHA-256 fingerprint in its certificate details matches
          the one shown on the server under Settings › Security &amp; devices before you connect.
        </p>
      ) : null}

      <Field label="Name this device">
        <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
      </Field>

      <Button variant="primary" size="lg" fullWidth disabled={!consent || busy || !secureContext} loading={busy} onClick={() => void connect()}>
        {busy ? 'Pairing…' : 'Connect'}
      </Button>
    </Gate>
  );
}
