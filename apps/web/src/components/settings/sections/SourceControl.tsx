// ────────────────────────────────────────────────────────────────
// Settings → Source Control.
//
// Connected accounts (several are allowed — multiple GitHub logins, an
// Enterprise host alongside github.com), the sign-in methods the SERVER
// says it can actually run right now, the model that writes commit
// messages and PR text, the default editor, and the fallback base branch.
//
// Tokens are write-only: a PAT goes up in the "Paste a token" form and
// never comes back in any response — the account list identifies an
// account by login/host/method, never by secret.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Github, Plus, Star, Trash2, Copy, ExternalLink, Terminal, KeyRound, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  useSourceControlSettings,
  useUpdateSourceControlSettings,
  useAddSourceControlAccount,
  useRemoveSourceControlAccount,
  useStartDeviceLogin,
  useDeviceLoginStatus,
  useHarnessProviders,
} from '@/hooks/queries.js';
import { Badge, Button, Input, Select, Spinner, useConfirm } from '@/components/ui/index.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { toast } from '@/components/Toast.js';
import { cn } from '@/lib/utils.js';
import { SectionHeader, SettingsCard } from '../shared.js';
import type {
  EditorId,
  SourceControlAccount,
  SourceControlAuthMethod,
} from '@generatorai/shared';

/** How each sign-in method presents itself in the "Connect account" row. */
const METHOD_META: Record<SourceControlAuthMethod, { label: string; icon: React.ElementType }> = {
  device: { label: 'Sign in with GitHub', icon: Github },
  token: { label: 'Paste a token', icon: KeyRound },
  'gh-cli': { label: 'Use GitHub CLI', icon: Terminal },
};

/** Stable order regardless of what the server lists first. */
const METHOD_ORDER: SourceControlAuthMethod[] = ['device', 'token', 'gh-cli'];

export function SourceControlSection() {
  const { data, isLoading, error } = useSourceControlSettings();
  const updateSettings = useUpdateSourceControlSettings();
  const addAccount = useAddSourceControlAccount();
  const removeAccount = useRemoveSourceControlAccount();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [activeMethod, setActiveMethod] = useState<SourceControlAuthMethod | null>(null);
  const [defaultBase, setDefaultBase] = useState('');

  const settings = data?.settings;
  const editors = useMemo(() => data?.editors ?? [], [data?.editors]);
  const accounts = useMemo(() => settings?.accounts ?? [], [settings?.accounts]);

  useEffect(() => {
    if (settings) setDefaultBase(settings.defaultBase ?? '');
  }, [settings]);

  // Which methods the server can run — the union across providers, because
  // GitHub is the only provider today and a second one would add rows here
  // rather than a whole second panel.
  const loginMethods = useMemo(() => {
    const set = new Set<SourceControlAuthMethod>();
    for (const p of data?.providers ?? []) for (const m of p.loginMethods) set.add(m);
    return METHOD_ORDER.filter((m) => set.has(m));
  }, [data?.providers]);

  // ── The commit/PR text model ──
  //
  // ModelPicker yields a bare model id; the settings shape wants the harness
  // provider too. Derive it exactly the way the picker does — from the live
  // catalog of every READY provider — so the pair can never disagree with
  // what the user actually picked.
  const { data: harness } = useHarnessProviders();
  const modelOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of harness?.providers ?? []) {
      if (!p.ready) continue;
      for (const m of p.models) map.set(m.id, m.provider ?? p.type);
    }
    return map;
  }, [harness]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      const generation = modelId
        ? { provider: modelOwner.get(modelId) ?? harness?.primary ?? null, model: modelId }
        : { provider: null, model: null };
      updateSettings.mutate({ generation });
    },
    [modelOwner, harness?.primary, updateSettings],
  );

  const handleDefaultEditor = useCallback(
    (value: string) => {
      updateSettings.mutate({ editor: { defaultEditor: (value || null) as EditorId | null } });
    },
    [updateSettings],
  );

  const handleSetDefaultAccount = useCallback(
    (accountId: string) => updateSettings.mutate({ defaultAccountId: accountId }),
    [updateSettings],
  );

  const handleDisconnect = useCallback(
    async (account: SourceControlAccount) => {
      const ok = await confirm({
        title: 'Disconnect account?',
        description: `${account.label} will no longer be used for pull requests or pushes. The stored token is deleted.`,
        confirmLabel: 'Disconnect',
        variant: 'destructive',
      });
      if (!ok) return;
      try {
        await removeAccount.mutateAsync(account.id);
        toast({ variant: 'success', title: 'Account disconnected', description: account.label });
      } catch (e) {
        toast({
          variant: 'error',
          title: 'Could not disconnect the account',
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [confirm, removeAccount],
  );

  const saveDefaultBase = useCallback(() => {
    const next = defaultBase.trim();
    if ((settings?.defaultBase ?? '') === next) return;
    updateSettings.mutate({ defaultBase: next || null });
  }, [defaultBase, settings?.defaultBase, updateSettings]);

  return (
    <div data-testid="settings-source-control">
      <SectionHeader
        title="Source Control"
        description="Connect the accounts GeneratorAI uses to push branches and open pull requests. Tokens are stored on the server and never returned to the browser."
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Spinner /></div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3.5 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Could not load source-control settings: {(error as Error).message}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Accounts ─────────────────────────────────────── */}
          <SettingsCard
            title="Accounts"
            description="Used to push branches and open pull requests. The account for a repository is picked by matching its remote host, falling back to the default."
          >
            {accounts.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground" data-testid="scm-no-accounts">
                No accounts connected yet. Connect one below to enable pushes and pull requests.
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="scm-accounts">
                {accounts.map((account) => {
                  const isDefault = settings?.defaultAccountId === account.id;
                  return (
                    <li key={account.id} className="flex items-center gap-3 py-2.5" data-testid="scm-account">
                      {account.avatarUrl ? (
                        <img
                          src={account.avatarUrl}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-full border border-border"
                        />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-subtle">
                          <Github className="h-4 w-4" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {account.login ?? account.label}
                          </span>
                          {isDefault && <Badge tone="primary" size="sm">Default</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {account.host ?? 'github.com'} · {METHOD_META[account.authMethod]?.label ?? account.authMethod}
                        </div>
                      </div>
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefaultAccount(account.id)}
                          loading={updateSettings.isPending}
                          leftIcon={<Star className="h-3.5 w-3.5" />}
                          className="shrink-0 text-xs"
                        >
                          Set default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDisconnect(account)}
                        aria-label={`Disconnect ${account.label}`}
                        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                        className="shrink-0 text-xs text-danger hover:bg-danger-muted"
                      >
                        Disconnect
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── Connect ─────────────────────────────────────── */}
            <div className="mt-4 border-t border-border pt-4">
              <div className="mb-2 text-xs font-medium text-foreground">Connect account</div>
              {loginMethods.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No sign-in method is available on this server.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {loginMethods.map((method) => {
                    const meta = METHOD_META[method];
                    const Icon = meta.icon;
                    return (
                      <Button
                        key={method}
                        variant={activeMethod === method ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setActiveMethod((m) => (m === method ? null : method))}
                        leftIcon={<Icon className="h-3.5 w-3.5" />}
                        data-testid={`scm-connect-${method}`}
                      >
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {activeMethod === 'device' && (
                <DeviceLoginPanel onDone={() => setActiveMethod(null)} />
              )}
              {activeMethod === 'token' && (
                <TokenPanel
                  busy={addAccount.isPending}
                  onSubmit={async (input) => {
                    await addAccount.mutateAsync({ provider: 'github', method: 'token', ...input });
                    setActiveMethod(null);
                    toast({ variant: 'success', title: 'GitHub account connected' });
                  }}
                />
              )}
              {activeMethod === 'gh-cli' && (
                <GhCliPanel
                  busy={addAccount.isPending}
                  onSubmit={async (host) => {
                    await addAccount.mutateAsync({
                      provider: 'github',
                      method: 'gh-cli',
                      ...(host ? { host } : {}),
                    });
                    setActiveMethod(null);
                    toast({ variant: 'success', title: 'Imported the GitHub CLI token' });
                  }}
                />
              )}
              {addAccount.isError && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {(addAccount.error as Error).message}
                </p>
              )}
            </div>
          </SettingsCard>

          {/* ── Generation + editor + base ───────────────────── */}
          <SettingsCard title="Defaults">
            <div className="space-y-4">
              <div>
                <label htmlFor="scm-generation-model" className="mb-1.5 block text-xs font-medium text-foreground">
                  Model for commit messages &amp; PR text
                </label>
                <ModelPicker
                  id="scm-generation-model"
                  variant="field"
                  allowEmpty
                  emptyLabel="Heuristic (no model)"
                  emptyDescription="Write plain descriptive text from the change set instead of calling a model."
                  value={settings?.generation.model ?? ''}
                  onChange={handleModelChange}
                  ariaLabel="Model for commit messages and PR text"
                />
              </div>

              <div>
                <label htmlFor="scm-default-editor" className="mb-1.5 block text-xs font-medium text-foreground">
                  Default editor
                </label>
                <Select
                  id="scm-default-editor"
                  value={settings?.editor.defaultEditor ?? ''}
                  onChange={handleDefaultEditor}
                  aria-label="Default editor"
                  options={[
                    { value: '', label: 'None', description: 'Hide the "Open in editor" actions.' },
                    ...editors.map((editor) => ({
                      value: editor.id,
                      label: editor.available ? editor.name : `${editor.name} — not found on this machine`,
                      description: editor.available
                        ? undefined
                        : `Still usable from a browser via ${editor.scheme}:// links.`,
                    })),
                  ]}
                />
                {editors.length > 0 && editors.every((e) => !e.available) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    None of these were found on the server host. Opening a file will fall back to
                    the editor&rsquo;s URL scheme in your browser.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="scm-default-base" className="mb-1.5 block text-xs font-medium text-foreground">
                  Fallback base branch
                </label>
                <Input
                  id="scm-default-base"
                  value={defaultBase}
                  onChange={(e) => setDefaultBase(e.target.value)}
                  onBlur={saveDefaultBase}
                  placeholder="main"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Used only when a repository&rsquo;s own default branch cannot be resolved.
                </p>
              </div>
            </div>
          </SettingsCard>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ── Device flow ──────────────────────────────────────────────────

/**
 * GitHub's OAuth device flow: the server starts it, we show the user code
 * and the verification link, and poll at the interval GitHub asked for
 * (polling faster earns a `slow_down`, which restarts the clock).
 */
function DeviceLoginPanel({ onDone }: { onDone: () => void }) {
  const start = useStartDeviceLogin();
  const [loginId, setLoginId] = useState<string | undefined>(undefined);
  const [host, setHost] = useState('');
  const started = start.data;
  const status = useDeviceLoginStatus(loginId, started?.interval ?? 5);

  useEffect(() => {
    if (status.data?.status === 'complete') {
      toast({
        variant: 'success',
        title: 'GitHub account connected',
        description: status.data.account?.label,
      });
      setLoginId(undefined);
      onDone();
    }
  }, [status.data, onDone]);

  const copyCode = useCallback(async () => {
    if (!started?.userCode) return;
    try {
      await navigator.clipboard.writeText(started.userCode);
      toast({ variant: 'success', title: 'Code copied' });
    } catch {
      toast({ variant: 'error', title: 'Could not copy the code' });
    }
  }, [started?.userCode]);

  if (!started) {
    return (
      <div className="mt-3 space-y-2 rounded-md border border-border bg-subtle/40 p-3">
        <label htmlFor="scm-device-host" className="block text-xs font-medium text-foreground">
          Enterprise host <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="scm-device-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="https://ghe.example.com"
        />
        <Button
          variant="primary"
          size="sm"
          loading={start.isPending}
          leftIcon={<Github className="h-3.5 w-3.5" />}
          data-testid="scm-device-start"
          onClick={() => {
            start.mutate(
              { provider: 'github', ...(host.trim() ? { host: host.trim() } : {}) },
              { onSuccess: (res) => setLoginId(res.loginId) },
            );
          }}
        >
          Start sign-in
        </Button>
        {start.isError && (
          <p className="text-xs text-danger" role="alert">{(start.error as Error).message}</p>
        )}
      </div>
    );
  }

  const expired = status.data?.status === 'expired';
  const failed = status.data?.status === 'error';

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-subtle/40 p-3" data-testid="scm-device-panel">
      <div>
        <div className="text-xs text-muted-foreground">Enter this code on GitHub:</div>
        <div className="mt-1 flex items-center gap-2">
          <code
            className="rounded bg-card px-2.5 py-1 font-mono text-base tracking-[0.3em] text-foreground"
            data-testid="scm-device-code"
          >
            {started.userCode}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void copyCode()}
            aria-label="Copy the device code"
            data-testid="scm-device-copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <a
        href={started.verificationUri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        data-testid="scm-device-link"
      >
        Open GitHub <ExternalLink className="h-3 w-3" />
      </a>
      <div className="flex items-center gap-2 text-xs" data-testid="scm-device-status">
        {expired || failed ? (
          <>
            <AlertTriangle className="h-3.5 w-3.5 text-danger" />
            <span className="text-danger">
              {failed ? (status.data?.error ?? 'Sign-in failed.') : 'The code expired — start again.'}
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setLoginId(undefined); start.reset(); }}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Spinner size="xs" />
            <span className="text-muted-foreground">Waiting for you to authorise on GitHub…</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Personal access token ────────────────────────────────────────

function TokenPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: { token: string; host?: string; label?: string }) => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div className="mt-3 space-y-2.5 rounded-md border border-border bg-subtle/40 p-3" data-testid="scm-token-panel">
      <div>
        <label htmlFor="scm-token" className="mb-1 block text-xs font-medium text-foreground">
          Personal access token
        </label>
        <Input
          id="scm-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_… or a fine-grained token"
          autoComplete="off"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Needs the <code>repo</code> scope; <code>workflow</code> is optional.
        </p>
      </div>
      <div>
        <label htmlFor="scm-token-host" className="mb-1 block text-xs font-medium text-foreground">
          Enterprise host <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="scm-token-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="https://ghe.example.com"
        />
      </div>
      <div>
        <label htmlFor="scm-token-label" className="mb-1 block text-xs font-medium text-foreground">
          Label <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="scm-token-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="work account"
        />
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={!token.trim()}
        loading={busy}
        leftIcon={<Plus className="h-3.5 w-3.5" />}
        data-testid="scm-token-submit"
        onClick={() => {
          void onSubmit({
            token: token.trim(),
            ...(host.trim() ? { host: host.trim() } : {}),
            ...(label.trim() ? { label: label.trim() } : {}),
          }).then(() => { setToken(''); setHost(''); setLabel(''); }).catch(() => {});
        }}
      >
        Connect
      </Button>
    </div>
  );
}

// ── gh CLI ───────────────────────────────────────────────────────

function GhCliPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (host: string) => Promise<void> }) {
  const [host, setHost] = useState('');
  return (
    <div className="mt-3 space-y-2.5 rounded-md border border-border bg-subtle/40 p-3" data-testid="scm-ghcli-panel">
      <p className="text-xs text-muted-foreground">
        Imports the token the <code>gh</code> CLI already holds on the server host. Requires
        <code> gh auth login</code> to have been run there.
      </p>
      <Input
        value={host}
        onChange={(e) => setHost(e.target.value)}
        placeholder="Enterprise host (optional)"
        aria-label="Enterprise host"
      />
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        leftIcon={<Terminal className="h-3.5 w-3.5" />}
        data-testid="scm-ghcli-submit"
        onClick={() => { void onSubmit(host.trim()).catch(() => {}); }}
      >
        Import token
      </Button>
    </div>
  );
}

/** Small connected/disconnected pip, exported for reuse by the changes tab. */
export function ScmConnectedPip({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium',
        connected ? 'text-success' : 'text-muted-foreground',
      )}
    >
      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {connected ? 'Connected' : 'Not connected'}
    </span>
  );
}
