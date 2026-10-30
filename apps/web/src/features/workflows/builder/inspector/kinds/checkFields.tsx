// ────────────────────────────────────────────────────────────────
// The command parts of a command stage (P05 §1.2; kind `check`), shared with
// a map's item setup steps: the command line, typed freely (D-174), the
// mount, the working directory and the environment table. The program must
// be on this computer's allow-list; one that is not can be allowed right
// here by an administrator. Arguments are literals (a template is refused:
// run values reach the command through env only). A command runs repository
// code, so saving one needs an administrator (the note).
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  DEFAULT_COMMAND_ALLOWLIST,
  OPT_IN_COMMANDS,
  formatCommandLine,
  parseCommandLine,
  type CheckSpec,
} from '@generatorai/workflow-spec';
import { useWorkflowBuilderStore, type BuilderIssue } from '@/stores/workflowBuilderStore.js';
import { useAllowCommand, useScriptAllowlist } from '@/hooks/scriptQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { InlineCode } from '@/ui/primitives/InlineCode/InlineCode.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { FieldIssues, issuesAt } from '../../fields/FieldIssues.js';
import { InspectorNote, InspectorRow } from '../../fields/InspectorLayout.js';
import { NameField, renameKey, withoutKey } from '../../fields/stageFields.js';

const TEMPLATE_PATTERN = /\{\{/;

/** What an opt-in program can do, for the warning before allowing it. */
const OPT_IN_RISK: Record<string, string> = {
  sh: 'runs any shell script',
  bash: 'runs any shell script',
  curl: 'downloads and uploads anything',
  wget: 'downloads anything',
  rm: 'deletes files',
  mv: 'moves and overwrites files',
  cp: 'overwrites files',
  chmod: 'changes file permissions',
};

/** `spec` with `updates` merged in; an `undefined` value removes the field. */
export function mergeCheckSpec(spec: CheckSpec, updates: Partial<CheckSpec>): CheckSpec {
  const next: Record<string, unknown> = { ...spec, ...updates };
  for (const [k, v] of Object.entries(updates)) if (v === undefined) delete next[k];
  return next as CheckSpec;
}

/** The admin note every command-bearing panel shows. */
export function CommandAdminNote({ what = 'A command stage runs a program in the repository' }: { what?: string }) {
  return (
    <Callout tone="info">
      {what} (the run needs the <InlineCode dense>shell</InlineCode> capability). Saving a workflow with one needs an
      administrator (the <InlineCode dense>admin:settings</InlineCode> scope): the server refuses it otherwise.
    </Callout>
  );
}

/** The program name as the allow-list compares it (`npm.cmd` → `npm`). */
function programName(command: string): string {
  return command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

/**
 * The command of a command stage (or of a map item setup step): the command
 * line as one text field, the mount and the working directory.
 * `pointer` locates the validator's issues (`/check`, `/map/itemSetup/0`).
 */
export function CheckCommandFields({
  spec,
  onChange,
  issues,
  pointer,
  label = 'Command',
}: {
  spec: CheckSpec;
  onChange: (updates: Partial<CheckSpec>) => void;
  issues: readonly BuilderIssue[];
  pointer: string;
  /** Accessible name prefix of the controls ("Command line", "Setup step 1 line"). */
  label?: string;
}) {
  const { data: allowlist, isLoading } = useScriptAllowlist();
  const allow = useAllowCommand();
  const aliases = useWorkflowBuilderStore(useShallow((s) => s.workflow.lifecycle.codebaseAliases));

  // What is typed; the spec takes it whenever it parses. Replaced when the spec changes elsewhere (undo, another stage).
  const formatted = formatCommandLine(spec.command, spec.args);
  const [line, setLine] = useState(formatted);
  const parsed = parseCommandLine(line);
  const inSync = parsed.ok && formatCommandLine(parsed.command, parsed.args) === formatted;
  useEffect(() => {
    if (!inSync) setLine(formatted);
    // Only an outside change of the spec resets the text; typing never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatted]);

  // The server's effective list (defaults, the operator's extras, those allowed in the app); the
  // spec's defaults until it arrives.
  const commands = allowlist?.commands.length ? allowlist.commands : [...DEFAULT_COMMAND_ALLOWLIST];
  const program = programName(spec.command);
  const notAllowed = !isLoading && !commands.includes(program);
  const risk = OPT_IN_COMMANDS.includes(program) ? (OPT_IN_RISK[program] ?? 'can change or remove files') : null;
  const templatedArgs = spec.args.filter((a) => TEMPLATE_PATTERN.test(a));
  const lineIssues = [...issuesAt(issues, `${pointer}/command`), ...issuesAt(issues, `${pointer}/args`)];

  const allowProgram = () =>
    allow.mutate(program, {
      onSuccess: () => toast.done(`${program} is allowed on this computer`),
      onError: (err) => toast.error(`Could not allow ${program}: ${err instanceof Error ? err.message : String(err)}`),
    });

  return (
    <>
      <InspectorRow
        label="Command"
        hint={
          <>
            One program and its arguments, as you would type it. It runs without a shell: no{' '}
            <InlineCode dense>&amp;&amp;</InlineCode>, pipes or variables.
          </>
        }
      >
        <Input
          mono
          size="sm"
          value={line}
          onChange={(e) => {
            const next = e.target.value;
            setLine(next);
            const p = parseCommandLine(next);
            if (p.ok) onChange({ command: p.command, args: p.args });
          }}
          aria-label={`${label} line`}
          placeholder="pnpm --filter @pulse/api test"
          spellCheck={false}
          autoComplete="off"
          invalid={!parsed.ok || notAllowed || lineIssues.some((i) => i.severity === 'error')}
        />
        {!parsed.ok ? <InspectorNote tone="warn">{parsed.error}.</InspectorNote> : null}
        {parsed.ok && parsed.shellOperators.length > 0 ? (
          <InspectorNote tone="warn">
            <InlineCode dense>{parsed.shellOperators[0]}</InlineCode> reaches {spec.command} as a plain argument: there is no shell.
            Split the steps into stages, or run a script file.
          </InspectorNote>
        ) : null}
        {parsed.ok && notAllowed ? (
          <div className="flex flex-col items-start gap-1.5" data-testid="command-not-allowed">
            <InspectorNote tone="warn">
              <InlineCode dense>{program}</InlineCode> is not on this computer&apos;s allowed programs, so the run would refuse it.
              {risk ? ` It ${risk}: allow it only if you trust every workflow here.` : ''}
            </InspectorNote>
            <Button size="sm" variant="secondary" icon="check" loading={allow.isPending} onClick={allowProgram}>
              Allow {program}
            </Button>
          </div>
        ) : null}
        {templatedArgs.length > 0 ? (
          <InspectorNote tone="warn">
            {templatedArgs.length === 1 ? 'An argument contains' : `${templatedArgs.length} arguments contain`} a{' '}
            <InlineCode dense>{'{{…}}'}</InlineCode> template: pass run values through an environment variable.
          </InspectorNote>
        ) : null}
        <FieldIssues issues={notAllowed ? lineIssues.filter((i) => i.code !== 'check-command') : lineIssues} />
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
