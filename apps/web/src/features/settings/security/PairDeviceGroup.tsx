// Security › Pair a new device: generate a single-use code (10 minutes) and
// show the two things the other device needs — where to go, then what to
// type (the 12-character code in 3 groups of 4, D-42) — plus a QR that
// carries every address this server listens on. Open grants are listed under
// "Awaiting pairing" with Cancel.

import { useEffect, useRef, useState } from 'react';
import { PAIRING_CODE_LENGTH, endpointTrust, isTailscaleOrigin } from '@generatorai/shared';
import {
  useCancelPairing,
  useCreatePairing,
  type PairingResponse,
  type PendingPairing,
  type SecurityPosture,
} from '@/hooks/securityQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { PairingCodeInput } from '@/ui/patterns/PairingCodeInput/PairingCodeInput.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { PAIRING_PLATFORMS, SCOPE_PRESETS, ago, countdown, joinAddress, type PairingPlatform } from './securityModel.js';
import { CertificateCheckNote, useCopied } from './CertificatePanel.js';

type OnError = (err: unknown) => void;

/**
 * The pairing URL as a QR code, drawn locally: the code must never leave this
 * machine, so no hosted QR service. `qrcode` is loaded lazily.
 */
function PairingQr({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('qrcode');
        if (cancelled || !canvasRef.current) return;
        // Two device pixels per module, whatever the payload: a fixed width
        // made qrcode fall back to 4 px per module (a 550 px code) once the
        // offer outgrew 130 modules, and squeezed smaller codes to one pixel
        // per module, which phone cameras misread. `L` correction is plenty
        // for a code shown on a screen and keeps the module count down.
        await mod.toCanvas(canvasRef.current, text, { scale: 2, margin: 2, errorCorrectionLevel: 'L' });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (failed) return <p className="text-small text-fg-3">QR rendering is unavailable — use the address and code.</p>;
  return <canvas ref={canvasRef} aria-label="Pairing QR code" role="img" className="shrink-0 rounded-control" />;
}

function ActivePairing({
  pairing,
  onCancel,
  onExpired,
}: {
  pairing: PairingResponse;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [urlCopied, copyUrl] = useCopied();
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const address = joinAddress(pairing.joinUrl, window.location.origin);
  // A browser opening an address only this server's own CA vouches for is
  // shown a warning; say what to compare (D-110). A ts.net (or any public)
  // name has a trusted certificate (D-125), and the native lane is plain HTTP
  // (D-112): neither shows one.
  const certificate = pairing.tls && endpointTrust(address) === 'install-ca' ? pairing.tls : null;
  const tailscale = isTailscaleOrigin(address);
  const code = pairing.shortCode.replace(/[^A-Za-z0-9]/g, '').slice(0, PAIRING_CODE_LENGTH);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (pairing.expiresAt <= now) onExpired();
  }, [pairing.expiresAt, now, onExpired]);

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-raised p-4" data-testid="security-pairing-code">
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-fg-2">1 · On the device, open</span>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-ui text-fg select-all">{address}</span>
          <IconButton size="sm" icon={urlCopied ? 'check' : 'copy'} label="Copy address" onClick={() => copyUrl(address)} />
        </div>
        {certificate ? <CertificateCheckNote tls={certificate} /> : null}
        {tailscale ? (
          <p className="text-small text-fg-3" data-testid="security-pairing-tailscale">
            Works on any network where your devices are signed in to Tailscale.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-fg-2">2 · Enter this code</span>
        <div className="flex items-center gap-2">
          <PairingCodeInput value={code} onValueChange={() => undefined} readOnly className="flex-1" />
          <IconButton size="sm" icon={codeCopied ? 'check' : 'copy'} label="Copy code" onClick={() => copyCode(pairing.shortCode)} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <PairingQr text={pairing.pairingUrl} />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <p className="text-small text-fg-3">
            Or scan with the mobile app. The QR carries every address this server listens on, so it also works where the address
            above is not reachable.
          </p>
          {/* The same offer as text, for another computer's desktop app (Server › Add Server…, D-126). */}
          <Button size="sm" variant="ghost" icon={linkCopied ? 'check' : 'link'} onClick={() => copyLink(pairing.pairingUrl)}>
            {linkCopied ? 'Copied' : 'Copy pairing link'}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line-soft pt-3">
        <span className="font-mono text-small text-fg-2">Expires in {countdown(pairing.expiresAt, now)}</span>
        <span className="text-small text-fg-3">
          {pairing.requestedScopes.length} scope{pairing.requestedScopes.length === 1 ? '' : 's'}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-small text-fg-3">
        Anyone who sees this code can pair a device until it is used or expires. Do not screenshot it or paste it into a chat.
      </p>
    </div>
  );
}

export function PairDeviceGroup({
  posture,
  pending,
  onError,
}: {
  posture: SecurityPosture | undefined;
  pending: readonly PendingPairing[];
  onError: OnError;
}) {
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [platform, setPlatform] = useState<PairingPlatform>('mobile');
  const [presetId, setPresetId] = useState('default');
  const [includeRelay, setIncludeRelay] = useState(false);
  const create = useCreatePairing();
  const cancel = useCancelPairing();
  const preset = SCOPE_PRESETS.find((p) => p.id === presetId) ?? SCOPE_PRESETS[0]!;
  const relayOffered = Boolean(posture?.relay.enabled && posture.relay.clientAvailable);

  const generate = () => {
    create.mutate(
      {
        platform,
        deviceName: deviceName.trim(),
        ...(preset.scopes ? { scopes: preset.scopes } : {}),
        ...(includeRelay && relayOffered ? { includeRelay: true } : {}),
      },
      { onSuccess: setPairing, onError },
    );
  };

  const cancelGrant = (grantId: string) => {
    cancel.mutate(grantId, {
      onSuccess: () => setPairing((p) => (p?.grantId === grantId ? null : p)),
      onError,
    });
  };

  return (
    <section className="flex flex-col gap-2" data-testid="security-pair">
      <SectionHeader title="Pair a new device" level={3} hint="A single-use code that expires in 10 minutes" />
      {pairing ? (
        <ActivePairing
          pairing={pairing}
          onCancel={() => cancelGrant(pairing.grantId)}
          onExpired={() => setPairing(null)}
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-panel border border-line bg-raised p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Device name">
              <Input size="sm" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. Pixel 9" />
            </Field>
            <Field label="Platform">
              <Select
                size="sm"
                value={platform}
                onValueChange={(v) => v && setPlatform(v as PairingPlatform)}
                items={PAIRING_PLATFORMS}
              />
            </Field>
          </div>
          <Field label="Permissions" hint={preset.hint}>
            <Select
              size="sm"
              value={presetId}
              onValueChange={(v) => v && setPresetId(v)}
              items={SCOPE_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            />
          </Field>
          {relayOffered ? (
            <Checkbox
              checked={includeRelay}
              onCheckedChange={setIncludeRelay}
              label="Include relay access — lets this device reconnect from outside your network"
            />
          ) : null}
          <Button
            variant="primary"
            icon="scan"
            className="self-start"
            disabled={!deviceName.trim()}
            loading={create.isPending}
            onClick={generate}
          >
            Generate pairing code
          </Button>
        </div>
      )}
      {pending.length > 0 ? (
        <div className="flex flex-col gap-1 pt-1">
          <span className="text-small font-medium text-fg-2">Awaiting pairing</span>
          {pending.map((p) => (
            <div key={p.grantId} className="flex items-center gap-2 text-small text-fg-3">
              <span className="min-w-0 flex-1 truncate">
                {p.deviceName ?? 'Unnamed'} · {p.platform} · {p.attempts}/{p.maxAttempts} attempts · expires{' '}
                {p.expiresAt > Date.now() ? `in ${countdown(p.expiresAt, Date.now())}` : ago(p.expiresAt)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => cancelGrant(p.grantId)}>
                Cancel
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
