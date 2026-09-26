// ────────────────────────────────────────────────────────────────
// Running registry commands from inside the TUI.
//
// This is the payoff of the single registry: the palette, a keybinding and
// `generatorai run pause` all go through the same handler with the same
// validation and the same confirmation rules. The only difference is where
// the result and the errors are shown.
// ────────────────────────────────────────────────────────────────

import type { InvocationPlan } from '@generatorai/workflow-spec';
import {
  CliError,
  commandPath,
  describeInvocationPlan,
  formFieldsForSpec,
  formValuesToInput,
  shellOnlyHint,
  specNeedsForm,
  toCliError,
  validate,
  type CliContext,
  type CommandRegistry,
  type CommandSpec,
  type PaletteEntry,
} from '@generatorai/cli-core';
import type { TuiActions } from './store.js';

export interface CommandRunner {
  run(
    id: string,
    args: Record<string, unknown>,
    flags?: Record<string, unknown>,
  ): Promise<unknown>;
  runFromPalette(entry: PaletteEntry): Promise<void>;
  /**
   * Opens the spec's own schema-driven form (Phase 7 item 4), prefilled with
   * whatever the caller already knows (`presets`, keyed by arg/flag name),
   * and runs the command when it is submitted. Resolves with the command's
   * data, or `undefined` if the form was cancelled or the command failed
   * (which has already been reported to the user by then).
   *
   * This is how every authoring surface in the TUI invokes a command that
   * needs more than one value — there is exactly one form implementation,
   * and it is generated from the same spec the binary and the docs use.
   * `run.start` plans first and starts only after a y on the plan.
   */
  runWithForm(
    id: string,
    presets?: Record<string, unknown>,
    options?: { title?: string },
  ): Promise<unknown>;
}

export interface CommandRunnerOptions {
  registry: CommandRegistry;
  makeContext: () => Promise<CliContext>;
  actions: TuiActions;
}

export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const { registry, makeContext, actions } = options;

  async function execute(
    spec: CommandSpec,
    args: Record<string, unknown>,
    flags: Record<string, unknown>,
    options: { announce?: boolean } = {},
  ): Promise<unknown> {
    let context: CliContext | null = null;
    try {
      const validated = validate(spec, { args, flags });
      context = await makeContext();
      const result = await spec.handler(context, validated);

      if (options.announce !== false) {
        for (const warning of result.warnings ?? []) actions.toast(warning, 'warning');
        if (result.message) actions.toast(result.message, 'success');
      }
      return result.data;
    } catch (error) {
      const cliError = toCliError(error);
      // A cancelled confirmation is a user decision, not a failure worth an
      // error modal.
      if (cliError.code === 'CANCELLED') return undefined;

      actions.showOverlay({
        kind: 'error',
        title: commandPath(spec),
        message: cliError.message,
        ...(cliError.hint ? { hint: cliError.hint } : {}),
      });
      return undefined;
    } finally {
      await context?.dispose();
    }
  }

  /**
   * `run start` from the TUI: the same flags go to `run plan` first, and the
   * plan (stages by layer, skips, codebases, post-processing, permission
   * mode, warnings) is shown for a y/n before the run is invoked. A refused
   * plan is reported like any other command failure and starts nothing.
   */
  async function startRunAfterPlan(
    runner: CommandRunner,
    args: Record<string, unknown>,
    formFlags: Record<string, unknown>,
  ): Promise<unknown> {
    const planSpec = registry.get('run.plan');
    if (!planSpec) return runner.run('run.start', args, formFlags);
    const flags = { ...formFlags, client: 'tui' };
    const plan = (await execute(planSpec, args, flags, { announce: false })) as InvocationPlan | undefined;
    if (!plan) return undefined;
    return new Promise((resolve) => {
      actions.showOverlay({
        kind: 'confirm',
        title: `Start ${plan.workflowName}?`,
        message: describeInvocationPlan(plan, { maxStages: 12 }).join('\n'),
        danger: false,
        onAnswer: (confirmed) => {
          if (!confirmed) return resolve(undefined);
          void runner.run('run.start', args, flags).then(resolve);
        },
      });
    });
  }

  return {
    async run(id, args, flags = {}) {
      const spec = registry.get(id);
      if (!spec) {
        actions.toast(`Unknown command: ${id}`, 'error');
        return undefined;
      }

      // Destructive commands go through the same gate as the binary surface,
      // but as a modal rather than a terminal prompt.
      if (spec.destructive && flags['yes'] !== true) {
        return new Promise((resolve) => {
          actions.showOverlay({
            kind: 'confirm',
            message: `${commandPath(spec)} cannot be undone. Continue?`,
            danger: true,
            onAnswer: (confirmed) => {
              if (!confirmed) return resolve(undefined);
              void execute(spec, args, { ...flags, yes: true }).then(resolve);
            },
          });
        });
      }

      return execute(spec, args, flags);
    },

    async runWithForm(id, presets = {}, options = {}) {
      const spec = registry.get(id);
      if (!spec) {
        actions.toast(`Unknown command: ${id}`, 'error');
        return undefined;
      }

      const fields = formFieldsForSpec(spec, presets);
      if (fields.length === 0) return this.run(id, {}, {});

      return new Promise((resolve) => {
        actions.showOverlay({
          kind: 'form',
          title: options.title ?? commandPath(spec),
          description: spec.summary,
          fields,
          onSubmit: (values) => {
            const { args, flags } = formValuesToInput(fields, values);
            const started = id === 'run.start' ? startRunAfterPlan(this, args, flags) : this.run(id, args, flags);
            void started.then(resolve);
          },
          // A dismissed form resolves `undefined`, the same value a declined
          // confirm and a reported failure already resolve to — so every
          // caller's "did anything happen?" check is one comparison. Without
          // it the promise would never settle and every cancelled form would
          // strand its closure for the life of the process.
          onCancel: () => resolve(undefined),
        });
      });
    },

    async runFromPalette(entry) {
      const spec = registry.get(entry.id);
      if (!spec) return;

      // The TUI cannot collect a secret (its prompt port refuses by design)
      // or hand over the raw TTY (that happens through a pane), so a command
      // declaring either is never dispatched from here — the user gets the
      // one hint that tells them where it does work, not a generic failure.
      if (entry.shellOnlyHint ?? (spec.requires && spec.requires.length > 0)) {
        actions.toast(entry.shellOnlyHint ?? shellOnlyHint(commandPath(spec)), 'warning');
        return;
      }

      // A command that takes input cannot be fired blind from a palette.
      // This used to collect required ARGUMENTS through chained single-line
      // prompts and refuse outright ("needs options the palette cannot
      // collect yet") the moment a spec had a required FLAG — which covered
      // every authoring command in the registry. The schema-driven form
      // handles both halves, so the refusal is gone and optional flags are
      // reachable from the palette for the first time.
      if (entry.needsInput || specNeedsForm(spec)) {
        await this.runWithForm(spec.id);
        return;
      }

      await this.run(spec.id, {}, {});
    },
  };
}

export { CliError };
