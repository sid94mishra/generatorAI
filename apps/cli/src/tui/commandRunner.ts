// ────────────────────────────────────────────────────────────────
// Running registry commands from inside the TUI.
//
// This is the payoff of the single registry: the palette, a keybinding and
// `generatorai run pause` all go through the same handler with the same
// validation and the same confirmation rules. The only difference is where
// the result and the errors are shown.
// ────────────────────────────────────────────────────────────────

import {
  CliError,
  commandPath,
  toCliError,
  usageLine,
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
  ): Promise<unknown> {
    let context: CliContext | null = null;
    try {
      const validated = validate(spec, { args, flags });
      context = await makeContext();
      const result = await spec.handler(context, validated);

      for (const warning of result.warnings ?? []) actions.toast(warning, 'warning');
      if (result.message) actions.toast(result.message, 'success');
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

    async runFromPalette(entry) {
      const spec = registry.get(entry.id);
      if (!spec) return;

      // A command with required arguments cannot be fired blind from a
      // palette; collect them one at a time rather than failing validation
      // and showing the user a schema error they did not cause.
      if (entry.needsInput) {
        const collected: Record<string, unknown> = {};
        const required = spec.args.filter((a) => a.required);

        const askNext = (index: number): void => {
          const arg = required[index];
          if (!arg) {
            void this.run(spec.id, collected, {});
            return;
          }
          actions.showOverlay({
            kind: 'input',
            message: `${commandPath(spec)} — ${arg.name}: ${arg.description}`,
            initial: '',
            onSubmit: (value) => {
              collected[arg.name] = value;
              askNext(index + 1);
            },
          });
        };

        if (spec.flags.some((f) => f.required)) {
          actions.showOverlay({
            kind: 'error',
            title: commandPath(spec),
            message: 'This command needs options the palette cannot collect yet.',
            hint: `Run it from a shell: generatorai ${usageLine(spec)}`,
          });
          return;
        }

        askNext(0);
        return;
      }

      await this.run(spec.id, {}, {});
    },
  };
}

export { CliError };
