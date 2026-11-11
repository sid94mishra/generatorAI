// ────────────────────────────────────────────────────────────────
// One ACP agent's expanded row (docs/acp) — facts, install / update /
// uninstall, status, sign-in, connection test and environment variables —
// plus the terminal sign-in dialog (ACP-12) and the custom agent form
// (ACP-10). Data only through hooks/acpQueries.ts.
//
// Environment values are write-only: the server returns names only, and the
// terminal sign-in dialog shows variable NAMES; the copied command line
// carries the values (it is what the user runs).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { AcpAgentInfo, AcpAuthMethodInfo, AcpTerminalAuthSpec, AcpTestResult } from '@generatorai/shared';
import {
  useAcpTerminalAuth,
  useAddCustomAcpAgent,
  useAuthenticateAcpAgent,
  useInstallAcpAgent,
  useLogoutAcpAgent,
  useReinitializeAcpAgent,
  useRemoveCustomAcpAgent,
  useSetAcpAgentEnv,
  useTestAcpAgent,
  useUninstallAcpAgent,
  useUpdateAcpAgent,
} from '@/hooks/acpQueries.js';
import { formatWhen } from '@/lib/formatWhen.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { KeyValueList, type KeyValueItem } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Link } from '@/ui/primitives/Link/Link.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { SETTINGS_LABEL_WIDTH } from '../settingsLayout.js';
import { AUTH_STATE_LABEL, ENV_NAME, distributionLabel, installProgressLabel, installable, splitArgs } from './acpAgentModel.js';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong.');

export function AcpAgentDetails({ agent, enableError }: { agent: AcpAgentInfo; enableError: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <AgentFacts agent={agent} />
      {agent.custom ? <CustomActions agent={agent} /> : <InstallActions agent={agent} />}
      {enableError ? <Callout tone="err">{enableError}</Callout> : null}
      <AgentStatus agent={agent} />
      <EnvEditor agent={agent} />
    </div>
  );
}

function AgentFacts({ agent }: { agent: AcpAgentInfo }) {
  const items: KeyValueItem[] = [{ label: 'Agent id', value: agent.id, mono: true }];
  if (agent.custom && agent.command) {
    items.push({ label: 'Command', value: [agent.command.command, ...agent.command.args].join(' '), mono: true });
  }
  if (agent.version) items.push({ label: 'Latest version', value: agent.version, mono: true });
  if (agent.installed) {
    items.push({ label: 'Installed', value: `v${agent.installed.version} · ${formatWhen(agent.installed.installedAt)}`, mono: true });
  }
  if (!agent.custom) items.push({ label: 'Distribution', value: distributionLabel(agent) || 'None' });
  if (agent.distribution.package) items.push({ label: 'Package', value: agent.distribution.package, mono: true });
  if (agent.license) items.push({ label: 'Licence', value: agent.license });
  if (agent.authors?.length) items.push({ label: 'Authors', value: agent.authors.join(', ') });
  if (agent.website) items.push({ label: 'Website', value: <Link variant="external" href={agent.website}>{hostOf(agent.website)}</Link> });
  if (agent.repository) {
    items.push({ label: 'Repository', value: <Link variant="external" href={agent.repository}>{hostOf(agent.repository)}</Link> });
  }
  return <KeyValueList labelWidth={SETTINGS_LABEL_WIDTH} dense items={items} />;
}

/** "github.com/org/repo" — a link's visible text without the scheme. */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function InstallActions({ agent }: { agent: AcpAgentInfo }) {
  const install = useInstallAcpAgent();
  const update = useUpdateAcpAgent();
  const uninstall = useUninstallAcpAgent();
  const progress = agent.installing;
  const failure = install.error ?? update.error ?? uninstall.error;
  const pending = install.isPending || update.isPending || uninstall.isPending;

  if (!agent.installed && !installable(agent)) {
    return (
      <Callout tone="neutral" title="Not available here">
        {agent.distribution.unavailableReason ?? 'The registry has no build of this agent for this computer.'}
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {progress ? (
        <ProgressBar
          value={progress.phase === 'downloading' && progress.totalBytes ? progress.receivedBytes : null}
          max={progress.totalBytes ?? 100}
          label={installProgressLabel(progress)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!agent.installed ? (
            <Button
              variant="primary"
              size="sm"
              icon="download"
              loading={install.isPending}
              disabled={pending}
              onClick={() => install.mutate(agent.id)}
              data-testid={`acp-install-${agent.id}`}
            >
              {agent.distribution.unverified ? 'Install unverified build' : 'Install'}
            </Button>
          ) : null}
          {agent.installed && agent.updateAvailable ? (
            <Button variant="primary" size="sm" icon="download" loading={update.isPending} disabled={pending} onClick={() => update.mutate(agent.id)}>
              Update to v{agent.version}
            </Button>
          ) : null}
          {agent.installed ? (
            <Button variant="danger-ghost" size="sm" icon="trash" loading={uninstall.isPending} disabled={pending} onClick={() => uninstall.mutate(agent.id)}>
              Uninstall
            </Button>
          ) : null}
        </div>
      )}
      {!agent.installed && !progress && agent.distribution.unverified ? (
        <p className="text-small text-fg-3">The registry gives no checksum for this build, so the download cannot be verified.</p>
      ) : null}
      {agent.installError ? <Callout tone="err">{agent.installError}</Callout> : null}
      {failure ? <Callout tone="err">{errorText(failure)}</Callout> : null}
    </div>
  );
}

function CustomActions({ agent }: { agent: AcpAgentInfo }) {
  const remove = useRemoveCustomAcpAgent();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="danger-ghost" size="sm" icon="trash" loading={remove.isPending} onClick={() => remove.mutate(agent.id)}>
          Remove agent
        </Button>
      </div>
      {remove.error ? <Callout tone="err">{errorText(remove.error)}</Callout> : null}
    </div>
  );
}

function AgentStatus({ agent }: { agent: AcpAgentInfo }) {
  const test = useTestAcpAgent();
  const authenticate = useAuthenticateAcpAgent();
  const logout = useLogoutAcpAgent();
  const terminalAuth = useAcpTerminalAuth();
  const [pendingMethod, setPendingMethod] = useState<string | null>(null);
  const [terminalSpec, setTerminalSpec] = useState<AcpTerminalAuthSpec | null>(null);
  const status = agent.enabled ? agent.status : undefined;
  const canTest = agent.custom || agent.installed !== null;
  const actionError = authenticate.error ?? logout.error ?? terminalAuth.error;

  const signIn = (method: AcpAuthMethodInfo) => {
    if (method.type === 'terminal') {
      terminalAuth.mutate({ id: agent.id, methodId: method.id }, { onSuccess: (spec) => setTerminalSpec(spec) });
      return;
    }
    setPendingMethod(method.id);
    authenticate.mutate({ id: agent.id, methodId: method.id }, { onSettled: () => setPendingMethod(null) });
  };

  if (!canTest) return null;

  return (
    <div className="flex flex-col gap-2">
      <SectionHeader variant="label" flush title="Status" />
      {status ? (
        <KeyValueList
          labelWidth={SETTINGS_LABEL_WIDTH}
          dense
          items={[
            { label: 'Running', value: status.connected ? 'Yes' : 'No' },
            { label: 'Sign-in', value: AUTH_STATE_LABEL[status.authState] },
            { label: 'Models', value: status.ready ? String(status.modelCount) : 'None yet' },
            ...(status.agentInfo
              ? [{ label: 'Reports as', value: [status.agentInfo.title ?? status.agentInfo.name, status.agentInfo.version].filter(Boolean).join(' '), mono: true }]
              : []),
            ...(status.checkedAt ? [{ label: 'Checked', value: formatWhen(status.checkedAt) }] : []),
          ]}
        />
      ) : (
        <p className="text-small text-fg-3">Turn the agent on to start it and sign in. Its models then appear in the model picker.</p>
      )}
      {status?.error && status.error !== 'Starting…' ? <Callout tone={status.authState === 'unauthenticated' ? 'warn' : 'err'}>{status.error}</Callout> : null}

      <div className="flex flex-wrap items-center gap-2">
        {status && status.authState !== 'authenticated' && status.authState !== 'not_required'
          ? status.authMethods.map((method) => (
              <Button
                key={method.id}
                variant="primary"
                size="sm"
                icon={method.type === 'terminal' ? 'terminal' : 'power'}
                loading={pendingMethod === method.id || (terminalAuth.isPending && terminalAuth.variables?.methodId === method.id)}
                disabled={authenticate.isPending || terminalAuth.isPending}
                title={method.description}
                onClick={() => signIn(method)}
              >
                {status.authMethods.length === 1 ? 'Sign in' : `Sign in: ${method.name}`}
              </Button>
            ))
          : null}
        {status?.supportsLogout && status.authState === 'authenticated' ? (
          <Button variant="ghost" size="sm" icon="power" loading={logout.isPending} onClick={() => logout.mutate(agent.id)}>
            Sign out
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" icon="refresh" loading={test.isPending} onClick={() => test.mutate(agent.id)}>
          Test connection
        </Button>
      </div>
      {pendingMethod ? <p className="text-small text-fg-3">Finish signing in where the agent asks you to (often a browser window).</p> : null}
      {status && status.authMethods.length === 0 && !status.connected ? (
        <p className="text-small text-fg-3">Sign-in options appear once the agent has started.</p>
      ) : null}
      {actionError ? <Callout tone="err">{errorText(actionError)}</Callout> : null}
      {test.data ? <TestResult result={test.data} /> : null}
      {test.error ? <Callout tone="err">{errorText(test.error)}</Callout> : null}

      {terminalSpec ? <TerminalSignInDialog agent={agent} spec={terminalSpec} onClose={() => setTerminalSpec(null)} /> : null}
    </div>
  );
}

function TestResult({ result }: { result: AcpTestResult }) {
  const seconds = (result.durationMs / 1000).toFixed(1);
  if (!result.ok) return <Callout tone="err" title={`Connection failed after ${seconds} s`}>{result.error ?? 'The agent did not answer.'}</Callout>;
  const models = `${result.modelCount} model${result.modelCount === 1 ? '' : 's'}`;
  return (
    <Callout tone="ok" data-testid="acp-test-result">
      Connected in {seconds} s · {AUTH_STATE_LABEL[result.authState].toLowerCase()} · {models}
    </Callout>
  );
}

/** Quote one word for display (POSIX style), only when it needs it. */
const shown = (word: string): string => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);

function TerminalSignInDialog({ agent, spec, onClose }: { agent: AcpAgentInfo; spec: AcpTerminalAuthSpec; onClose: () => void }) {
  const reinitialize = useReinitializeAcpAgent();
  const [copied, setCopied] = useState<'posix' | 'powershell' | null>(null);
  const envNames = Object.keys(spec.env);
  const copy = (which: 'posix' | 'powershell') => {
    void navigator.clipboard?.writeText(which === 'posix' ? spec.posixCommandLine : spec.powershellCommandLine);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };
  const finish = () => reinitialize.mutate(agent.id, { onSuccess: onClose });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)} title={`Sign in to ${agent.name}`} data-testid="acp-terminal-sign-in">
      <DialogBody>
        <p className="text-ui text-fg-2">
          This sign-in runs in a terminal. Copy the command, run it in a terminal on the computer running GeneratorAI, follow
          its steps, then come back here.
        </p>
        <div className="flex flex-col gap-1.5">
          <SectionHeader variant="label" flush title="Command" />
          <CodeBlock wrap>{[spec.command, ...spec.args].map(shown).join(' ')}</CodeBlock>
          <p className="text-small text-fg-3">
            Runs in <span className="font-mono">{spec.cwd}</span>
          </p>
        </div>
        {envNames.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <SectionHeader variant="label" flush title="Environment" />
            <ul className="flex flex-wrap gap-1.5" aria-label="Environment variables">
              {envNames.map((name) => (
                <li key={name}>
                  <InlineCode>{name}</InlineCode>
                </li>
              ))}
            </ul>
            <p className="text-small text-fg-3">Values are hidden here; the copied command sets them.</p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon={copied === 'posix' ? 'check' : 'copy'} onClick={() => copy('posix')}>
            {copied === 'posix' ? 'Copied' : 'Copy for macOS or Linux'}
          </Button>
          <Button variant="secondary" size="sm" icon={copied === 'powershell' ? 'check' : 'copy'} onClick={() => copy('powershell')}>
            {copied === 'powershell' ? 'Copied' : 'Copy for PowerShell'}
          </Button>
        </div>
        {reinitialize.error ? <Callout tone="err">{errorText(reinitialize.error)}</Callout> : null}
      </DialogBody>
      <DialogFooter hint="The agent restarts and checks the sign-in.">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" loading={reinitialize.isPending} onClick={finish}>
          I&apos;ve finished signing in
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

interface EnvRow {
  name: string;
  value: string;
}

/** Name + write-only value rows. */
function EnvRows({ rows, onChange }: { rows: EnvRow[]; onChange: (rows: EnvRow[]) => void }) {
  const patch = (i: number, next: Partial<EnvRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            mono
            size="sm"
            aria-label="Variable name"
            placeholder="NAME"
            value={row.name}
            invalid={!!row.name.trim() && !ENV_NAME.test(row.name.trim())}
            onChange={(e) => patch(i, { name: e.target.value })}
            className="flex-1"
          />
          <Input
            mono
            size="sm"
            type="password"
            autoComplete="off"
            aria-label="Value"
            placeholder="value"
            value={row.value}
            onChange={(e) => patch(i, { value: e.target.value })}
            className="flex-1"
          />
          <IconButton size="sm" icon="x" label="Remove row" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} />
        </div>
      ))}
    </>
  );
}

/** Variables the agent starts with. Set names are listed; their values are never shown again. */
function EnvEditor({ agent }: { agent: AcpAgentInfo }) {
  const setEnv = useSetAcpAgentEnv();
  const [rows, setRows] = useState<EnvRow[]>([]);
  const distribution = Object.entries(agent.distributionEnv ?? {});
  const filled = rows.filter((r) => r.name.trim() || r.value);
  const invalid = filled.find((r) => !ENV_NAME.test(r.name.trim()));

  if (!agent.custom && !agent.installed) return null;

  const save = () => {
    if (invalid || filled.length === 0) return;
    const env = Object.fromEntries(filled.map((r) => [r.name.trim(), r.value]));
    setEnv.mutate({ id: agent.id, env }, { onSuccess: () => setRows([]) });
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionHeader
        variant="label"
        flush
        title="Environment variables"
        hint="Values are stored in the secrets vault and never shown again. A running agent restarts with the change."
      />
      {agent.env.length > 0 ? (
        <div className="flex flex-col divide-y divide-line-soft rounded-control border border-line">
          {agent.env.map((v) => (
            <div key={v.name} className="flex items-center gap-2 px-3 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-small text-fg">{v.name}</span>
              <span className="font-mono text-small text-fg-3">••••••</span>
              <IconButton
                size="sm"
                icon="trash"
                label={`Remove ${v.name}`}
                disabled={setEnv.isPending}
                onClick={() => setEnv.mutate({ id: agent.id, env: { [v.name]: null } })}
              />
            </div>
          ))}
        </div>
      ) : null}
      {distribution.length > 0 ? (
        <p className="text-small text-fg-3">
          Set by the registry:{' '}
          <span className="font-mono">{distribution.map(([k, v]) => `${k}=${v}`).join(' ')}</span>
        </p>
      ) : null}
      <EnvRows rows={rows} onChange={setRows} />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon="plus" onClick={() => setRows((cur) => [...cur, { name: '', value: '' }])}>
          Add variable
        </Button>
        {filled.length > 0 ? (
          <Button variant="primary" size="sm" loading={setEnv.isPending} disabled={!!invalid} onClick={save}>
            Save variables
          </Button>
        ) : null}
      </div>
      {invalid ? <p className="text-small text-err">“{invalid.name.trim() || '(empty)'}” is not a valid variable name.</p> : null}
      {setEnv.error ? <Callout tone="err">{errorText(setEnv.error)}</Callout> : null}
    </div>
  );
}

/** A custom agent: any command that speaks ACP over stdio (ACP-10). Enabled as soon as it is added. */
export function AcpCustomAgentForm({ onDone }: { onDone: () => void }) {
  const add = useAddCustomAcpAgent();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [rows, setRows] = useState<EnvRow[]>([]);
  const filled = rows.filter((r) => r.name.trim() || r.value);
  const invalid = filled.find((r) => !ENV_NAME.test(r.name.trim()));
  const canSave = name.trim().length > 0 && command.trim().length > 0 && !invalid;

  const save = () => {
    if (!canSave) return;
    const env = Object.fromEntries(filled.map((r) => [r.name.trim(), r.value]));
    add.mutate(
      {
        name: name.trim(),
        command: command.trim(),
        args: splitArgs(args),
        ...(filled.length > 0 ? { env } : {}),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-raised p-4" data-testid="acp-custom-agent-form">
      <SectionHeader variant="label" flush title="Custom agent" hint="Any command that speaks the Agent Client Protocol over standard input and output." />
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My agent" />
      </Field>
      <Field label="Command">
        <Input mono value={command} onChange={(e) => setCommand(e.target.value)} placeholder="/usr/local/bin/my-agent" />
      </Field>
      <Field label="Arguments" hint="Separated by spaces; quote an argument that contains spaces.">
        <Input mono value={args} onChange={(e) => setArgs(e.target.value)} placeholder="--acp" />
      </Field>
      <div className="flex flex-col gap-2">
        <SectionHeader variant="label" flush title="Environment variables" hint="Stored in the secrets vault and never shown again." />
        <EnvRows rows={rows} onChange={setRows} />
        <Button variant="ghost" size="sm" icon="plus" className="self-start" onClick={() => setRows((cur) => [...cur, { name: '', value: '' }])}>
          Add variable
        </Button>
        {invalid ? <p className="text-small text-err">“{invalid.name.trim() || '(empty)'}” is not a valid variable name.</p> : null}
      </div>
      {add.error ? <Callout tone="err">{errorText(add.error)}</Callout> : null}
      <div className="flex justify-end gap-2 border-t border-line-soft pt-3">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" loading={add.isPending} disabled={!canSave} onClick={save}>
          Add agent
        </Button>
      </div>
    </div>
  );
}
