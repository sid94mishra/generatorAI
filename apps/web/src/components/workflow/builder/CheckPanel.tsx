// ────────────────────────────────────────────────────────────────
// CheckPanel — the inspector of a check stage (P05 §1.2, WP-5A.5).
//
// One deterministic command, no LLM: the command comes from the
// server's allow-list, the arguments are literals (a template is
// refused: values reach the command through env only), and the output
// is the exit code plus the tails of stdout/stderr (optionally parsed
// JSON). A check runs repository code, so saving one needs an admin.
// `CheckCommandFields` (command, arguments, mount, working directory,
// environment) is shared with a map's `itemSetup` commands.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Clock, Info, Plus, Shield, SquareTerminal, Trash2, Variable } from 'lucide-react';
import { DEFAULT_COMMAND_ALLOWLIST, RetryPolicySchema, type CheckSpec, type CheckStage } from '@generatorai/workflow-spec';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowBuilderStore, type BuilderIssue, type StageUpdate } from '@/stores/workflowBuilderStore.js';
import { useScriptAllowlist } from '@/hooks/scriptQueries.js';
import { Button, Input, Select, ToggleSwitch } from '@/components/ui/index.js';
import { CollapsibleSection } from '../CollapsibleSection.js';
import { NumberStepper } from '../NumberStepper.js';
import { FieldIssues, issuesAt } from '../engineGate.js';
import { ArgsEditor, NameField, renameKey, withoutKey } from './fields.js';

interface CheckPanelProps {
  stage: CheckStage;
  onUpdate: (updates: StageUpdate) => void;
  issues: readonly BuilderIssue[];
}

const TEMPLATE_PATTERN = /\{\{/;

/** `spec` with `updates` merged in; an `undefined` value removes the field. */
export function mergeCheckSpec(spec: CheckSpec, updates: Partial<CheckSpec>): CheckSpec {
  const next: Record<string, unknown> = { ...spec, ...updates };
  for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
  return next as CheckSpec;
}

/** The admin note every command-bearing panel shows. */
export function CommandAdminNote({ what = 'A check runs a command in the repository' }: { what?: string }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-1.5 rounded-md bg-info-muted px-2 py-1.5 text-[11px] text-info">
      <Info className="mt-px h-3 w-3 shrink-0" />
      <span>
        {what} (the run needs the <code>shell</code> capability). Saving a workflow with one needs an administrator (the{' '}
        <code>admin:settings</code> scope): the server refuses it otherwise.
      </span>
    </div>
  );
}

export function CheckPanel({ stage, onUpdate, issues }: CheckPanelProps) {
  const check = stage.check;
  const setCheck = (updates: Partial<CheckSpec>) => onUpdate({ check: mergeCheckSpec(check, updates) });

  return (
    <div>
      <CommandAdminNote />

      <CollapsibleSection title="Command" icon={<SquareTerminal className="h-3.5 w-3.5" />} defaultOpen>
        <CheckCommandFields spec={check} onChange={setCheck} issues={issues} pointer="/check" idPrefix="check" />
      </CollapsibleSection>

      <CollapsibleSection
        title="Environment"
        icon={<Variable className="h-3.5 w-3.5" />}
        defaultOpen={!!check.env}
        badge={check.env ? String(Object.keys(check.env).length) : undefined}
      >
        <EnvTable env={check.env} onChange={(env) => setCheck({ env })} issues={issues} pointer="/check/env" />
      </CollapsibleSection>

      <CheckResultSections stage={stage} onUpdate={onUpdate} issues={issues} setCheck={setCheck} />
    </div>
  );
}

/**
 * The command of a check (or of a map item setup step): the allow-listed
 * executable, literal arguments, the mount and the working directory.
 * `pointer` locates the validator's issues (`/check`, `/map/itemSetup/0`).
 */
export function CheckCommandFields({
  spec,
  onChange,
  issues,
  pointer,
  idPrefix,
  label = 'Check',
}: {
  spec: CheckSpec;
  onChange: (updates: Partial<CheckSpec>) => void;
  issues: readonly BuilderIssue[];
  pointer: string;
  idPrefix: string;
  /** Accessible name prefix of the controls ("Check command"). */
  label?: string;
}) {
  const check = spec;
  const setCheck = onChange;
  const { data: allowlist, isLoading } = useScriptAllowlist();
  const aliases = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.codebaseAliases));

  // The server's effective list (defaults plus the operator's extras); the
  // spec's defaults until it arrives or when the server does not say.
  const commands = allowlist?.commands.length ? allowlist.commands : [...DEFAULT_COMMAND_ALLOWLIST];
  const extras = new Set(allowlist?.extras ?? []);
  const commandOptions = [
    ...(commands.includes(check.command)
      ? []
      : [{ value: check.command, label: check.command, description: 'Not on the allow-list: the save is refused' }]),
    ...[...commands].sort().map((c) => ({ value: c, label: c, description: extras.has(c) ? 'Added by the operator' : undefined })),
  ];
  const templatedArgs = check.args.filter((a) => TEMPLATE_PATTERN.test(a));

  return (
    <>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Command</label>
          <Select aria-label={`${label} command`} value={check.command} onChange={(command) => setCheck({ command })} options={commandOptions} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {isLoading ? 'Loading the allow-list…' : 'A bare executable from the allow-list; an operator can add more (scripts.extraAllowlist).'}
          </p>
          <FieldIssues issues={issuesAt(issues, `${pointer}/command`)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Arguments</label>
          <ArgsEditor
            args={check.args}
            onChange={(args) => setCheck({ args })}
            ariaLabel={`${label} arguments`}
            placeholder={'One per line\nexec\nvitest\nrun'}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Literal values only: a <code>{'{{…}}'}</code> template is refused. Pass run values through the environment.
          </p>
          {templatedArgs.length > 0 && (
            <p className="mt-1 text-[11px] text-danger">
              {templatedArgs.length === 1 ? 'An argument contains' : `${templatedArgs.length} arguments contain`} a template: move
              the value to an environment variable.
            </p>
          )}
          <FieldIssues issues={issuesAt(issues, `${pointer}/args`)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Mount</label>
          <Select
            aria-label={`${label} mount`}
            value={check.mount ?? ''}
            onChange={(v) => setCheck({ mount: v || undefined })}
            options={[
              { value: '', label: 'Primary mount' },
              ...[...new Set([...aliases, ...(check.mount ? [check.mount] : [])])].map((a) => ({
                value: a,
                label: a,
                description: aliases.includes(a) ? undefined : 'Not a codebase of this workflow',
              })),
            ]}
          />
          <FieldIssues issues={issuesAt(issues, `${pointer}/mount`)} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-cwd`} className="mb-1.5 block text-xs font-medium text-foreground">Working directory</label>
          <Input
            id={`${idPrefix}-cwd`}
            value={check.cwd ?? ''}
            onChange={(e) => setCheck({ cwd: e.target.value || undefined })}
            className="font-mono text-xs"
            placeholder="Relative to the mount root (e.g. packages/api)"
            spellCheck={false}
          />
          <FieldIssues issues={issuesAt(issues, `${pointer}/cwd`)} />
        </div>
    </>
  );
}

/** A check stage's result handling, timeouts and retry. */
function CheckResultSections({
  stage,
  onUpdate,
  issues,
  setCheck,
}: CheckPanelProps & { setCheck: (updates: Partial<CheckSpec>) => void }) {
  const check = stage.check;
  return (
    <>
      <CollapsibleSection title="Result" icon={<Shield className="h-3.5 w-3.5" />} defaultOpen>
        <ToggleSwitch
          checked={check.parseJson}
          onChange={(parseJson) => setCheck({ parseJson })}
          label="Parse stdout as JSON"
          description="The parsed value is output.json (a parse error is output.jsonError)."
        />
        <ToggleSwitch
          checked={check.failOnNonZero}
          onChange={(failOnNonZero) => setCheck({ failOnNonZero })}
          label="Fail the stage on a non-zero exit"
          description="Off: the stage completes with passed: false, which exit rules and edges can read."
        />
        <NumberStepper
          label="Output kept (KB of each stream's tail)"
          value={Math.round(check.tailBytes / 1024)}
          onChange={(kb) => setCheck({ tailBytes: kb * 1024 })}
          min={1}
          max={256}
          step={4}
          unit="KB"
        />
        <FieldIssues issues={issuesAt(issues, '/check/parseJson', '/check/failOnNonZero', '/check/tailBytes')} />
      </CollapsibleSection>

      <CollapsibleSection title="Timeouts and retry" icon={<Clock className="h-3.5 w-3.5" />} defaultOpen={false}>
        <NumberStepper
          label="Command timeout (seconds)"
          value={Math.round(check.timeoutMs / 1000)}
          onChange={(v) => setCheck({ timeoutMs: v * 1000 })}
          min={1}
          max={3600}
          step={30}
          unit="sec"
        />
        <FieldIssues issues={issuesAt(issues, '/check/timeoutMs')} />
        <NumberStepper
          label="Queue timeout (seconds, 0 = default)"
          value={stage.timeouts?.queueMs ? stage.timeouts.queueMs / 1000 : 0}
          onChange={(v) => onUpdate({ timeouts: v > 0 ? { queueMs: v * 1000 } : undefined })}
          min={0}
          max={86_400}
          step={30}
          unit="sec"
        />
        <FieldIssues issues={issuesAt(issues, '/timeouts')} />
        <ToggleSwitch
          checked={!!stage.retry}
          onChange={(checked) => onUpdate({ retry: checked ? RetryPolicySchema.parse({}) : undefined })}
          label="Retry on failure"
          description="Run the command again when an attempt fails (a failing exit only counts with Fail on non-zero)."
        />
        {stage.retry && (
          <NumberStepper
            label="Max attempts (including the first)"
            value={stage.retry.maxAttempts}
            onChange={(maxAttempts) => onUpdate({ retry: { ...stage.retry!, maxAttempts } })}
            min={1}
            max={10}
          />
        )}
        <FieldIssues issues={issuesAt(issues, '/retry')} />
      </CollapsibleSection>
    </>
  );
}

/** Environment variables: name → template (the only place run values reach the command). */
export function EnvTable({
  env,
  onChange,
  issues,
  pointer,
}: {
  env: Record<string, string> | undefined;
  onChange: (env: Record<string, string> | undefined) => void;
  issues: readonly BuilderIssue[];
  /** JSON pointer of the env object (`/check/env`). */
  pointer: string;
}) {
  // Rows added here stay until removed, even while their value is empty.
  const [pending, setPending] = useState<string[]>([]);
  const names = [...new Set([...Object.keys(env ?? {}), ...pending])];

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">
        Values are templates, e.g. <code>{'{{variables.target}}'}</code>, or a <code>secretref:workflow/&lt;name&gt;</code> reference.
      </p>
      {names.map((name) => (
        <div key={name}>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-1.5">
            <NameField
              name={name}
              taken={names.filter((n) => n !== name)}
              onRename={(next) => {
                setPending((p) => p.map((n) => (n === name ? next : n)));
                onChange(renameKey(env, name, next));
              }}
              ariaLabel={`Environment variable ${name} name`}
              placeholder="NAME"
            />
            <Input
              value={env?.[name] ?? ''}
              onChange={(e) => onChange({ ...(env ?? {}), [name]: e.target.value })}
              aria-label={`Environment variable ${name} value`}
              className="h-8 font-mono text-xs"
              placeholder="value or {{template}}"
              spellCheck={false}
            />
            <Button
              type="button"
              onClick={() => {
                setPending((p) => p.filter((n) => n !== name));
                onChange(withoutKey(env, name));
              }}
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove environment variable ${name}`}
              className="mt-1 h-auto w-auto p-1 text-muted-foreground hover:bg-transparent hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <FieldIssues issues={issuesAt(issues, `${pointer}/${name}`)} />
        </div>
      ))}
      <Button
        type="button"
        onClick={() => {
          let n = names.length + 1;
          while (names.includes(`VAR_${n}`)) n++;
          setPending((p) => [...p, `VAR_${n}`]);
        }}
        variant="ghost"
        size="sm"
        className="h-auto gap-1 bg-transparent p-0 text-xs text-primary hover:bg-transparent hover:underline"
      >
        <Plus className="h-3 w-3" /> Add variable
      </Button>
      <FieldIssues issues={issues.filter((i) => i.field === pointer)} />
    </div>
  );
}
