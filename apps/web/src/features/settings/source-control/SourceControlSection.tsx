// ────────────────────────────────────────────────────────────────
// F-settings-09 Source control (04 §3.1). Connected accounts (several are
// allowed — multiple GitHub logins, an Enterprise host alongside
// github.com), the sign-in methods the SERVER says it can actually run
// right now, the model that writes commit messages and PR text, the
// default editor, and the fallback base branch.
//
// Tokens are write-only: a PAT goes up in the "Paste a token" form and
// never comes back in any response — the account list identifies an
// account by login/host/method, never by secret.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EditorId, SourceControlAccount, SourceControlAuthMethod } from '@generatorai/shared';
import {
  useAddSourceControlAccount,
  useDeviceLoginStatus,
  useEditors,
  useRemoveSourceControlAccount,
  useSourceControlSettings,
  useStartDeviceLogin,
  useUpdateSourceControlSettings,
} from '@/hooks/queries.js';
import { useHarnessProviders } from '@/hooks/harnessQueries.js';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { GitHubMark } from '@/ui/icons/vendor/VendorIcons.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Avatar } from '@/ui/primitives/Avatar/Avatar.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection, SettingsTable, type SettingsTableColumn } from '@/ui/patterns/SettingsSection/SettingsSection.js';

/** How each sign-in method presents itself in the "Connect account" row. */
const METHOD_META: Record<SourceControlAuthMethod, { label: string; icon: (props: { className?: string }) => ReactNode }> = {
  device: { label: 'Sign in with GitHub', icon: (p) => <GitHubMark {...p} /> },
  token: { label: 'Paste a token', icon: (p) => <Icon concept="key" size={14} className={p.className} /> },
  'gh-cli': { label: 'Use GitHub CLI', icon: (p) => <Icon concept="terminal" size={14} className={p.className} /> },
};

/** Stable order regardless of what the server lists first. */
const METHOD_ORDER: SourceControlAuthMethod[] = ['device', 'token', 'gh-cli'];

export function SourceControlSection() {
  const { data, isLoading, error } = useSourceControlSettings();
  const updateSettings = useUpdateSourceControlSettings();
  const addAccount = useAddSourceControlAccount();
  const removeAccount = useRemoveSourceControlAccount();
  const { data: editorsData } = useEditors();
  const confirmer = useConfirm();

  const [activeMethod, setActiveMethod] = useState<SourceControlAuthMethod | null>(null);
  const [defaultBase, setDefaultBase] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const settings = data?.settings;
  const editors = useMemo(() => data?.editors ?? editorsData ?? [], [data?.editors, editorsData]);
  const accounts = useMemo(() => settings?.accounts ?? [], [settings?.accounts]);

  useEffect(() => {
    if (settings) setDefaultBase(settings.defaultBase ?? '');
  }, [settings]);

  const loginMethods = useMemo(() => {
    const set = new Set<SourceControlAuthMethod>();
    for (const p of data?.providers ?? []) for (const m of p.loginMethods) set.add(m);
    return METHOD_ORDER.filter((m) => set.has(m));
  }, [data?.providers]);

  // ModelPicker yields a bare model id; the settings shape wants the harness
  // provider too — derived exactly the way the picker does, from the live
  // catalog of every READY provider, so the pair can never disagree.
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
      const generation = modelId ? { provider: modelOwner.get(modelId) ?? harness?.primary ?? null, model: modelId } : { provider: null, model: null };
      updateSettings.mutate({ generation });
    },
    [modelOwner, harness?.primary, updateSettings],
  );

  const handleDefaultEditor = useCallback(
    (value: string | null) => updateSettings.mutate({ editor: { defaultEditor: (value || null) as EditorId | null } }),
    [updateSettings],
  );

  const handleSetDefaultAccount = useCallback((accountId: string) => updateSettings.mutate({ defaultAccountId: accountId }), [updateSettings]);

  const handleDisconnect = useCallback(
    async (account: SourceControlAccount) => {
      const ok = await confirmer.confirm({
        title: 'Disconnect account?',
        description: `${account.label} will no longer be used for pull requests or pushes. The stored token is deleted.`,
        confirmLabel: 'Disconnect',
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await removeAccount.mutateAsync(account.id);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      }
    },
    [confirmer, removeAccount],
  );

  const saveDefaultBase = useCallback(() => {
    const next = defaultBase.trim();
    if ((settings?.defaultBase ?? '') === next) return;
    updateSettings.mutate({ defaultBase: next || null });
  }, [defaultBase, settings?.defaultBase, updateSettings]);

  const accountColumns: SettingsTableColumn<SourceControlAccount>[] = [
    {
      id: 'account',
      header: 'Account',
      width: '1fr',
      cell: (account) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={account.login ?? account.label} src={account.avatarUrl} size={24} decorative />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-fg">{account.login ?? account.label}</span>
            <span className="truncate text-small text-fg-3">
              {account.host ?? 'github.com'} · {METHOD_META[account.authMethod]?.label ?? account.authMethod}
            </span>
          </span>
          {settings?.defaultAccountId === account.id ? <Badge tone="neutral">Default</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <SettingsSection
      title="Source control"
      description="Connect the accounts GeneratorAI uses to push branches and open pull requests. Tokens are stored on the server and never returned to the browser."
      data-testid="settings-source-control"
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <Callout tone="err">Could not load source-control settings: {(error as Error).message}</Callout>
      ) : (
        <>
          {actionError ? (
            <Callout tone="err" action={<IconButton size="sm" icon="x" label="Dismiss" onClick={() => setActionError(null)} />}>
              {actionError}
            </Callout>
          ) : null}

          <section className="flex flex-col gap-2">
            <SectionHeader
              title="Accounts"
              level={3}
              hint="Used to push branches and open pull requests. The account for a repository is picked by matching its remote host, falling back to the default."
            />
            <SettingsTable
              label="Accounts"
              columns={accountColumns}
              rows={accounts}
              getRowId={(a) => a.id}
              data-testid="scm-accounts"
              actionsWidth={140}
              empty={<p className="text-small text-fg-3" data-testid="scm-no-accounts">No accounts connected yet. Connect one below to enable pushes and pull requests.</p>}
              rowActions={(account) => (
                <span className="flex items-center justify-end gap-1" data-testid="scm-account">
                  {settings?.defaultAccountId !== account.id ? (
                    <Button size="sm" variant="ghost" icon="pin" loading={updateSettings.isPending} onClick={() => handleSetDefaultAccount(account.id)}>
                      Set default
                    </Button>
                  ) : null}
                  <IconButton size="sm" icon="trash" label={`Disconnect ${account.label}`} onClick={() => void handleDisconnect(account)} />
                </span>
              )}
            />

            <div className="mt-2 flex flex-col gap-2 border-t border-line-soft pt-3">
              <SectionHeader variant="label" title="Connect account" />
              {loginMethods.length === 0 ? (
                <p className="text-small text-fg-3">No sign-in method is available on this server.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {loginMethods.map((method) => {
                    const meta = METHOD_META[method];
                    return (
                      <Button
                        key={method}
                        variant={activeMethod === method ? 'primary' : 'secondary'}
                        size="sm"
                        data-testid={`scm-connect-${method}`}
                        onClick={() => setActiveMethod((m) => (m === method ? null : method))}
                      >
                        <span className="mr-1.5 inline-flex">{meta.icon({ className: 'size-3.5' })}</span>
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {activeMethod === 'device' ? <DeviceLoginPanel onDone={() => setActiveMethod(null)} /> : null}
              {activeMethod === 'token' ? (
                <TokenPanel
                  busy={addAccount.isPending}
                  onSubmit={async (input) => {
                    await addAccount.mutateAsync({ provider: 'github', method: 'token', ...input });
                    setActiveMethod(null);
                  }}
                />
              ) : null}
              {activeMethod === 'gh-cli' ? (
                <GhCliPanel
                  busy={addAccount.isPending}
                  onSubmit={async (host) => {
                    await addAccount.mutateAsync({ provider: 'github', method: 'gh-cli', ...(host ? { host } : {}) });
                    setActiveMethod(null);
                  }}
                />
              ) : null}
              {addAccount.isError ? (
                <p className="text-small text-err" role="alert">
                  {(addAccount.error as Error).message}
                </p>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col">
            <SectionHeader title="Defaults" level={3} />
            <SettingRow
              label="Model for commit messages & PR text"
              hint="Leave unset to write plain descriptive text from the change set instead of calling a model."
              control={
                <div className="flex items-center gap-1.5">
                  <div className="w-56">
                    <ModelPicker value={settings?.generation.model ?? ''} onChange={handleModelChange} variant="field" ariaLabel="Model for commit messages and PR text" />
                  </div>
                  {settings?.generation.model ? (
                    <IconButton size="sm" icon="x" label="Use heuristic instead" onClick={() => handleModelChange('')} />
                  ) : null}
                </div>
              }
            />
            <SettingRow
              label="Default editor"
              hint={editors.length > 0 && editors.every((e) => !e.available) ? "None of these were found on the server host. Opening a file will fall back to the editor's URL scheme in your browser." : undefined}
              control={
                <div className="w-56">
                  <Select
                    aria-label="Default editor"
                    value={settings?.editor.defaultEditor ?? ''}
                    onValueChange={handleDefaultEditor}
                    items={[
                      { value: '', label: 'None' },
                      ...editors.map((editor) => ({
                        value: editor.id,
                        label: editor.available ? editor.name : `${editor.name} — not found on this machine`,
                      })),
                    ]}
                  />
                </div>
              }
            />
            <SettingRow
              label="Fallback base branch"
              hint="Used only when a repository's own default branch cannot be resolved."
              control={
                <div className="w-40">
                  <Input aria-label="Fallback base branch" value={defaultBase} onChange={(e) => setDefaultBase(e.target.value)} onBlur={saveDefaultBase} placeholder="main" />
                </div>
              }
            />
          </section>
        </>
      )}
      {confirmer.dialog}
    </SettingsSection>
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
      setLoginId(undefined);
      onDone();
    }
  }, [status.data, onDone]);

  const copyCode = useCallback(async () => {
    if (!started?.userCode) return;
    try {
      await navigator.clipboard.writeText(started.userCode);
    } catch {
      /* clipboard unavailable — the code is still selectable */
    }
  }, [started?.userCode]);

  if (!started) {
    return (
      <div className="mt-1 flex flex-col gap-2 rounded-control-sm border border-line bg-sunken p-3">
        <Input
          aria-label="Enterprise host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="Enterprise host (optional) — https://ghe.example.com"
        />
        <Button
          variant="primary"
          size="sm"
          className="self-start"
          loading={start.isPending}
          data-testid="scm-device-start"
          onClick={() => start.mutate({ provider: 'github', ...(host.trim() ? { host: host.trim() } : {}) }, { onSuccess: (res) => setLoginId(res.loginId) })}
        >
          <GitHubMark className="mr-1.5 size-3.5" /> Start sign-in
        </Button>
        {start.isError ? (
          <p className="text-small text-err" role="alert">
            {(start.error as Error).message}
          </p>
        ) : null}
      </div>
    );
  }

  const expired = status.data?.status === 'expired';
  const failed = status.data?.status === 'error';

  return (
    <div className="mt-1 flex flex-col gap-3 rounded-control-sm border border-line bg-sunken p-3" data-testid="scm-device-panel">
      <div>
        <div className="text-small text-fg-3">Enter this code on GitHub:</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="rounded-control-sm bg-raised px-2.5 py-1 font-mono text-title tracking-widest text-fg" data-testid="scm-device-code">
            {started.userCode}
          </code>
          <IconButton size="sm" icon="copy" label="Copy the device code" onClick={() => void copyCode()} data-testid="scm-device-copy" />
        </div>
      </div>
      <a
        href={started.verificationUri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-small font-medium text-fg hover:underline"
        data-testid="scm-device-link"
      >
        Open GitHub <Icon concept="external-link" size={12} />
      </a>
      <div className="flex items-center gap-2 text-small" data-testid="scm-device-status">
        {expired || failed ? (
          <>
            <Icon concept="warning" size={14} className="text-err" />
            <span className="text-err">{failed ? status.data?.error ?? 'Sign-in failed.' : 'The code expired — start again.'}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setLoginId(undefined);
                start.reset();
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <>
            <Spinner size={14} />
            <span className="text-fg-3">Waiting for you to authorise on GitHub…</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Personal access token ────────────────────────────────────────

function TokenPanel({ busy, onSubmit }: { busy: boolean; onSubmit: (input: { token: string; host?: string; label?: string }) => Promise<void> }) {
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div className="mt-1 flex flex-col gap-2.5 rounded-control-sm border border-line bg-sunken p-3" data-testid="scm-token-panel">
      <div className="flex flex-col gap-1">
        <label htmlFor="scm-token" className="text-small font-medium text-fg-2">
          Personal access token
        </label>
        <Input id="scm-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or a fine-grained token" autoComplete="off" mono />
        <p className="text-small text-fg-3">
          Needs the <code className="font-mono">repo</code> scope; <code className="font-mono">workflow</code> is optional.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="scm-token-host" className="text-small font-medium text-fg-2">
          Enterprise host <span className="text-fg-3">(optional)</span>
        </label>
        <Input id="scm-token-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://ghe.example.com" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="scm-token-label" className="text-small font-medium text-fg-2">
          Label <span className="text-fg-3">(optional)</span>
        </label>
        <Input id="scm-token-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="work account" />
      </div>
      <Button
        variant="primary"
        size="sm"
        className="self-start"
        disabled={!token.trim()}
        loading={busy}
        icon="plus"
        data-testid="scm-token-submit"
        onClick={() => {
          void onSubmit({ token: token.trim(), ...(host.trim() ? { host: host.trim() } : {}), ...(label.trim() ? { label: label.trim() } : {}) })
            .then(() => {
              setToken('');
              setHost('');
              setLabel('');
            })
            .catch(() => {});
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
    <div className="mt-1 flex flex-col gap-2.5 rounded-control-sm border border-line bg-sunken p-3" data-testid="scm-ghcli-panel">
      <p className="text-small text-fg-3">
        Imports the token the <code className="font-mono">gh</code> CLI already holds on the server host. Requires <code className="font-mono">gh auth login</code> to have been run
        there.
      </p>
      <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Enterprise host (optional)" aria-label="Enterprise host" />
      <Button variant="primary" size="sm" className="self-start" loading={busy} icon="terminal" data-testid="scm-ghcli-submit" onClick={() => void onSubmit(host.trim()).catch(() => {})}>
        Import token
      </Button>
    </div>
  );
}
