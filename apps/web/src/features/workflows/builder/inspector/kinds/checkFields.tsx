// ────────────────────────────────────────────────────────────────
// The command parts of a check stage (P05 §1.2), shared with a map's item
// setup steps: the allow-listed executable, literal arguments (a template
// is refused: run values reach the command through env only), the mount,
// the working directory and the environment table. A command runs
// repository code, so saving one needs an administrator (the note).
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_COMMAND_ALLOWLIST, type CheckSpec } from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { useScriptAllowlist } from '@/hooks/scriptQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow } from '../../fields/InspectorLayout.js';
import { ArgsEditor, NameField, renameKey, withoutKey } from '../../fields/stageFields.js';

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
    <Callout tone="info">
      {what} (the run needs the <InlineCode dense>shell</InlineCode> capability). Saving a workflow with one needs an
      administrator (the <InlineCode dense>admin:settings</InlineCode> scope): the server refuses it otherwise.
    </Callout>
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
  label = 'Check',
}: {
  spec: CheckSpec;
  onChange: (updates: Partial<CheckSpec>) => void;
  issues: readonly BuilderIssue[];
  pointer: string;
  /** Accessible name prefix of the controls ("Check command"). */
  label?: string;
}) {
  const { data: allowlist, isLoading } = useScriptAllowlist();
  const aliases = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.codebaseAliases));

  // The server's effective list (defaults plus the operator's extras); the
  // spec's defaults until it arrives or when the server does not say.
  const commands = allowlist?.commands.length ? allowlist.commands : [...DEFAULT_COMMAND_ALLOWLIST];
  const extras = new Set(allowlist?.extras ?? []);
  const commandItems = [
    ...(commands.includes(spec.command) ? [] : [{ value: spec.command, label: spec.command, meta: 'not allowed' }]),
    ...[...commands].sort().map((c) => ({ value: c, label: c, meta: extras.has(c) ? 'operator' : undefined })),
  ];
  const templatedArgs = spec.args.filter((a) => TEMPLATE_PATTERN.test(a));
  const commandIssues = issuesAt(issues, `${pointer}/command`);
  const notAllowed = !commands.includes(spec.command);

  return (
    <>
      <InspectorRow
        label="Command"
        hint={
          notAllowed
            ? 'Not on the allow-list: the save is refused.'
            : isLoading
              ? 'Loading the allow-list…'
              : 'A bare executable from the allow-list; an operator can add more (scripts.extraAllowlist).'
        }
      >
        <Select
          aria-label={`${label} command`}
          size="sm"
          value={spec.command}
          onValueChange={(command) => command && onChange({ command })}
          items={commandItems}
          invalid={notAllowed || commandIssues.some((i) => i.severity === 'error')}
        />
        <FieldIssues issues={commandIssues} />
      </InspectorRow>
      <InspectorRow
        label="Arguments"
        hint={
          <>
            Literal values only: a <InlineCode dense>{'{{…}}'}</InlineCode> template is refused. Pass run values through the
            environment.
          </>
        }
      >
        <ArgsEditor args={spec.args} onChange={(args) => onChange({ args })} ariaLabel={`${label} arguments`} placeholder={'One per line\nexec\nvitest\nrun'} />
        {templatedArgs.length > 0 ? (
          <InspectorNote tone="warn">
            {templatedArgs.length === 1 ? 'An argument contains' : `${templatedArgs.length} arguments contain`} a template: move the
            value to an environment variable.
          </InspectorNote>
        ) : null}
        <FieldIssues issues={issuesAt(issues, `${pointer}/args`)} />
      </InspectorRow>
      <InspectorRow label="Mount">
        <Select
          aria-label={`${label} mount`}
          size="sm"
          value={spec.mount ?? ''}
          onValueChange={(v) => onChange({ mount: v || undefined })}
          items={[
            { value: '', label: 'Primary mount' },
            ...[...new Set([...aliases, ...(spec.mount ? [spec.mount] : [])])].map((a) => ({
              value: a,
              label: a,
              meta: aliases.includes(a) ? undefined : 'not a codebase',
            })),
          ]}
        />
        <FieldIssues issues={issuesAt(issues, `${pointer}/mount`)} />
      </InspectorRow>
      <InspectorRow label="Working dir" optional>
        <Input
          mono
          size="sm"
          value={spec.cwd ?? ''}
          onChange={(e) => onChange({ cwd: e.target.value || undefined })}
          aria-label={`${label} working directory`}
          placeholder="Relative to the mount root (e.g. packages/api)"
          spellCheck={false}
        />
        <FieldIssues issues={issuesAt(issues, `${pointer}/cwd`)} />
      </InspectorRow>
    </>
  );
}

/** Environment variables: name → template (the only place run values reach the command). */
export function EnvTable({
  env,
  onChange,
  issues,
  pointer,
  label = 'Environment variable',
}: {
  env: Record<string, string> | undefined;
  onChange: (env: Record<string, string> | undefined) => void;
  issues: readonly BuilderIssue[];
  /** JSON pointer of the env object (`/check/env`). */
  pointer: string;
  /** Accessible name prefix of a row's controls. */
  label?: string;
}) {
  // Rows added here stay until removed, even while their value is empty.
  const [pending, setPending] = useState<string[]>([]);
  const names = [...new Set([...Object.keys(env ?? {}), ...pending])];

  return (
    <div className="flex flex-col gap-2">
      <InspectorNote>
        Values are templates, e.g. <InlineCode dense>{'{{variables.target}}'}</InlineCode>, or a{' '}
        <InlineCode dense>secretref:workflow/&lt;name&gt;</InlineCode> reference.
      </InspectorNote>
      {names.map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <div className="grid grid-cols-5 items-start gap-1.5">
            <div className="col-span-2 min-w-0">
              <NameField
                name={name}
                taken={names.filter((n) => n !== name)}
                onRename={(next) => {
                  setPending((p) => p.map((n) => (n === name ? next : n)));
                  onChange(renameKey(env, name, next));
                }}
                ariaLabel={`${label} ${name} name`}
                placeholder="NAME"
              />
            </div>
            <div className="col-span-3 flex min-w-0 items-start gap-1">
              <Input
                mono
                size="sm"
                className="min-w-0 flex-1"
                value={env?.[name] ?? ''}
                onChange={(e) => onChange({ ...(env ?? {}), [name]: e.target.value })}
                aria-label={`${label} ${name} value`}
                placeholder="value or {{template}}"
                spellCheck={false}
              />
              <IconButton
                icon="trash"
                size="sm"
                label={`Remove ${label.toLowerCase()} ${name}`}
                onClick={() => {
                  setPending((p) => p.filter((n) => n !== name));
                  onChange(withoutKey(env, name));
                }}
              />
            </div>
          </div>
          <FieldIssues issues={issuesAt(issues, `${pointer}/${name}`)} />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="-ml-2"
          onClick={() => {
            let n = names.length + 1;
            while (names.includes(`VAR_${n}`)) n++;
            setPending((p) => [...p, `VAR_${n}`]);
          }}
        >
          Add variable
        </Button>
      </div>
      <FieldIssues issues={issues.filter((i) => i.field === pointer)} />
    </div>
  );
}
