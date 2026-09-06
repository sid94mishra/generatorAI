// ────────────────────────────────────────────────────────────────
// WebhookCredentialsDialog — one-time reveal of a webhook token +
// HMAC signing secret, shown only right after create/rotate.
//
// The server never returns the raw token or signing secret again after
// this response (GET/list/update responses are redacted to `SECRET_MASK`),
// so this dialog is the only place either value is ever visible. There is
// deliberately no way to reopen it for the same credentials — only "rotate"
// mints a new one-time pair.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Copy, Check, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';

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

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <code
          className={`flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </code>
        <Button variant="ghost" size="icon" onClick={handleCopy} title={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export function WebhookCredentialsDialog({ open, onClose, credentials }: Props) {
  if (!credentials) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Webhook credentials"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="primary" onClick={onClose}>
            I've saved these
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-muted p-3 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Shown once. If you lose these, rotate the webhook to generate a new pair — the old
            token and secret stop working immediately.
          </span>
        </div>

        <CopyField label="Webhook URL" value={credentials.webhookUrl} mono />
        <CopyField label="Token (X-Webhook-Token header, or the URL above)" value={credentials.token} mono />
        {credentials.signingSecret && (
          <CopyField label="Signing secret (HMAC key)" value={credentials.signingSecret} mono />
        )}

        {credentials.signingSecret && (
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">To verify deliveries are genuine</p>
            <p>
              Have your sender sign the raw request body with this secret (HMAC-SHA256) and send the
              result as <code className="font-mono">X-Signature-256: sha256=&lt;hex&gt;</code>.
              Deliveries without a valid signature are rejected.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
