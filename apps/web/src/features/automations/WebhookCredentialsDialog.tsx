// ────────────────────────────────────────────────────────────────
// WebhookCredentialsDialog — one-time reveal of a webhook token + HMAC
// signing secret, shown only right after create/rotate. Ported from
// components/automation/WebhookCredentialsDialog.tsx onto the kit (D-35
// fallback port); feature-local (its only importers are this feature's own
// detail and create pages).
//
// The server never returns the raw token or signing secret again after this
// response (GET/list/update responses are redacted), so this dialog is the
// only place either value is ever visible. There is deliberately no way to
// reopen it for the same credentials — only "rotate" mints a new pair.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';

export interface WebhookCredentials {
  /** Full delivery URL, e.g. `https://host/api/automations/webhooks/<token>`. */
  webhookUrl: string;
  /** Raw token — also usable via the `X-Webhook-Token` header instead of the URL. */
  token: string;
  /** Raw HMAC signing secret, when one was minted (webhook automations always get one on create/rotate). */
  signingSecret?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  credentials: WebhookCredentials | null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small font-medium text-fg-2">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-control border border-line-soft bg-sunken px-3 py-2 font-mono text-small text-fg">
          {value}
        </code>
        <IconButton icon={copied ? 'check' : 'copy'} label={`Copy ${label.toLowerCase()}`} onClick={handleCopy} />
      </div>
    </div>
  );
}

/** One-time reveal of a webhook's token + signing secret (create / rotate). */
export function WebhookCredentialsDialog({ open, onClose, credentials }: Props) {
  if (!credentials) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Webhook credentials" size="md">
      <DialogBody>
        <Callout tone="warn" title="Shown once">
          If you lose these, rotate the webhook to generate a new pair — the old token and secret stop working
          immediately.
        </Callout>
        <CopyField label="Webhook URL" value={credentials.webhookUrl} />
        <CopyField label="Token (X-Webhook-Token header, or the URL above)" value={credentials.token} />
        {credentials.signingSecret ? <CopyField label="Signing secret (HMAC key)" value={credentials.signingSecret} /> : null}
        {credentials.signingSecret ? (
          <Callout title="To verify deliveries are genuine">
            Have your sender sign the raw request body with this secret (HMAC-SHA256) and send the result as{' '}
            <code className="font-mono">X-Signature-256: sha256=&lt;hex&gt;</code>. Deliveries without a valid
            signature are rejected.
          </Callout>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onClose}>
          I&rsquo;ve saved these
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
