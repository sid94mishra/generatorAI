// Security › Network exposure › HTTPS certificate (D-110, D-113). What other
// devices are shown when they connect: the fingerprint to compare with the
// browser's certificate warning (first 8 bytes, the whole value copied), the
// names it covers and its expiry; the local CA for a user who wants the
// warning gone; and "Use your own certificate" for one devices already trust
// (tailscale cert, mkcert, a company CA). Also the short "check the
// fingerprint" note the pairing panel shows next to an https:// address.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInstallCertificate, useRemoveCertificate, type NetworkTls, type TlsStatus } from '@/hooks/securityQueries.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { FileInput } from '@/ui/primitives/FileInput/FileInput.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { certificateDate, shortCertificateFingerprint } from './securityModel.js';

/** Copy to the clipboard; `copied` is true for 1.5 s after. */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [
    copied,
    (text) => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      });
    },
  ];
}

/** The fingerprint, grouped for reading aloud, with a copy button for the full value. */
export function CertificateFingerprint({ fingerprint, testId }: { fingerprint: string; testId?: string }) {
  const [copied, copy] = useCopied();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate font-mono text-ui text-fg select-all" data-testid={testId} title={fingerprint}>
        {shortCertificateFingerprint(fingerprint)}
      </span>
      <IconButton size="sm" icon={copied ? 'check' : 'copy'} label="Copy certificate fingerprint" onClick={() => copy(fingerprint)} />
    </span>
  );
}

/** Next to an https:// address the other device will open: what its warning means and what to compare. */
export function CertificateCheckNote({ tls }: { tls: TlsStatus }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-sunken p-3" data-testid="security-certificate-check">
      <p className="text-small text-fg-2">
        {tls.source === 'generated'
          ? 'The other device will warn that the connection is not private. That is expected: this computer made its own certificate. Before you continue there, open the certificate details and check the SHA-256 fingerprint starts with:'
          : 'If the other device warns about the certificate, open its details and check the SHA-256 fingerprint starts with:'}
      </p>
      <CertificateFingerprint fingerprint={tls.fingerprintSha256} />
      <p className="text-small text-fg-3">If it does not match, stop: something between the two devices is pretending to be this computer.</p>
    </div>
  );
}

function readFile(file: File): Promise<string> {
  return file.text();
}

function OwnCertificateDialog({
  open,
  onOpenChange,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (err: unknown) => void;
}) {
  const [certificatePem, setCertificatePem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const install = useInstallCertificate();

  useEffect(() => {
    if (!open) {
      setCertificatePem('');
      setPrivateKeyPem('');
      setError(null);
    }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    install.mutate(
      { certificatePem, privateKeyPem },
      {
        onSuccess: () => onOpenChange(false),
        // The server names what is wrong (wrong key, expired, which names it covers).
        onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const pick = (set: (value: string) => void) => (files: FileList) => {
    const file = files[0];
    if (file) void readFile(file).then(set, onError);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" title="Use your own certificate" data-testid="security-own-certificate">
      <form onSubmit={submit} className="contents">
        <DialogBody>
          <p className="text-small text-fg-2">
            For a certificate your devices already trust — from <span className="font-mono">tailscale cert</span>, mkcert or your company's
            CA. It must name this computer (an address, its .local name, or its Tailscale name), and the key must not have a passphrase.
          </p>
          <Field label="Certificate (PEM, chain allowed)">
            <Textarea
              value={certificatePem}
              onChange={(e) => setCertificatePem(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder="-----BEGIN CERTIFICATE-----"
              textareaClassName="font-mono text-small"
            />
          </Field>
          <FileInput accept=".pem,.crt,.cer" multiple={false} onFilesSelected={pick(setCertificatePem)}>
            {(openPicker) => (
              <Button size="sm" variant="ghost" icon="upload" className="self-start" onClick={openPicker}>
                Load certificate file…
              </Button>
            )}
          </FileInput>
          <Field label="Private key (PEM)" error={error ?? undefined}>
            <Textarea
              value={privateKeyPem}
              onChange={(e) => setPrivateKeyPem(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="-----BEGIN PRIVATE KEY-----"
              textareaClassName="font-mono text-small"
              invalid={Boolean(error)}
            />
          </Field>
          <FileInput accept=".pem,.key" multiple={false} onFilesSelected={pick(setPrivateKeyPem)}>
            {(openPicker) => (
              <Button size="sm" variant="ghost" icon="upload" className="self-start" onClick={openPicker}>
                Load key file…
              </Button>
            )}
          </FileInput>
        </DialogBody>
        <DialogFooter hint="The key is stored in this server's encrypted vault.">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" variant="primary" loading={install.isPending} disabled={!certificatePem.trim() || !privateKeyPem.trim()}>
            Use this certificate
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** HTTPS certificate details under Network exposure. Rendered only while the server is exposed. */
export function CertificateGroup({ tls, onError }: { tls: NetworkTls; onError: (err: unknown) => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const remove = useRemoveCertificate();

  if (!tls.enabled) {
    return (
      <Callout tone="warn" title="Other devices can't connect yet" data-testid="security-certificate">
        {tls.unavailableReason ?? 'This server is not serving HTTPS.'} Browsers and the mobile app on other devices connect only over HTTPS.
      </Callout>
    );
  }

  const generated = tls.source === 'generated';
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-raised p-4" data-testid="security-certificate">
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium text-fg">HTTPS certificate</span>
        <Badge tone={generated ? 'neutral' : 'ok'}>{generated ? 'Made by this computer' : 'Your certificate'}</Badge>
      </div>
      <KeyValueList
        labelWidth={120}
        dense
        items={[
          { label: 'Fingerprint', value: <CertificateFingerprint fingerprint={tls.fingerprintSha256} testId="security-certificate-fingerprint" /> },
          { label: 'Covers', value: tls.names.join(', '), mono: true },
          { label: 'Expires', value: certificateDate(tls.notAfter) },
          ...(generated ? [] : [{ label: 'Issued by', value: tls.issuer }]),
        ]}
      />
      <p className="text-small text-fg-3">
        {generated
          ? 'Other devices see a warning the first time, because no public authority signed this certificate. Compare the fingerprint above with the one in their certificate details. To stop the warning on a device you own, install this computer’s certificate authority there.'
          : 'Devices that trust the authority that issued it connect without a warning.'}
      </p>
      {tls.customCertificateProblem ? <Callout tone="warn">{tls.customCertificateProblem} Serving the certificate this computer made instead.</Callout> : null}
      <div className="flex flex-wrap items-center gap-2">
        {generated ? (
          <Link href="/api/auth/tls/ca.crt" download="generatorai-local-ca.crt" className="text-small">
            Download certificate authority
          </Link>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialogOpen(true)}>
          {generated ? 'Use your own certificate…' : 'Replace…'}
        </Button>
        {generated ? null : (
          <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(undefined, { onError })}>
            Use the generated certificate
          </Button>
        )}
      </div>
      <OwnCertificateDialog open={dialogOpen} onOpenChange={setDialogOpen} onError={onError} />
    </div>
  );
}
