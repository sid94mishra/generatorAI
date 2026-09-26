// ────────────────────────────────────────────────────────────────
// CommandSpec[] → a Commander program.
//
// Commander is kept because it already handles the tedious parts (help
// layout, `--` passthrough, error formatting). What it does NOT do is let
// four other consumers read the same definition, which is why the specs live
// upstream of it rather than inside it.
// ────────────────────────────────────────────────────────────────

import type { Command } from 'commander';
import type { CliContext } from '../context/CliContext.js';
import { CliError } from '../errors/CliError.js';
import {
  commandPath,
  flagToCli,
  usageLine,
  type CommandFlag,
  type CommandResult,
  type CommandSpec,
} from './CommandSpec.js';
import type { CommandRegistry } from './registry.js';

export interface RunOptions {
  /** Built lazily so `--help` and `config` never open a connection. */
  createContext(spec: CommandSpec): Promise<CliContext>;
  /** Presentation. Receives the spec so it can honour `output`. */
  render(spec: CommandSpec, result: CommandResult): Promise<void> | void;
  onError(error: unknown, spec?: CommandSpec): Promise<void> | void;
  /** Called after every command, success or failure. */
  onSettled?(spec: CommandSpec, ctx: CliContext | null): Promise<void> | void;
}

function flagSignature(flag: CommandFlag): string {
  const long = flagToCli(flag.name);
  const head = flag.short ? `-${flag.short}, ${long}` : long;
  if (flag.type === 'boolean') return head;
  const placeholder = flag.variadic ? `<${flag.name}...>` : `<${flag.name}>`;
  return `${head} ${placeholder}`;
}

/** Commander hands back kebab-case-derived camelCase; specs use camelCase already. */
function collectRepeatable(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function attachCommands(
  program: Command,
  registry: CommandRegistry,
  options: RunOptions,
): void {
  // Commander models `run stage pause` as nested subcommands. Build the tree
  // once, keyed by the path prefix, so each spec attaches to the right parent.
  const containers = new Map<string, Command>();

  const containerFor = (spec: CommandSpec): Command => {
    const decl = registry.groupDeclaration(spec.group);
    let node = containers.get(spec.group);
    if (!node) {
      node = program
        .command(spec.group)
        .description(decl?.summary ?? `${spec.group} commands`);
      for (const alias of decl?.aliases ?? []) node.alias(alias);
      containers.set(spec.group, node);
    }

    // Intermediate verbs (`stage` in `run stage pause`) get their own node.
    const verbParts = spec.verb ? spec.verb.split(' ') : [];
    let prefix = spec.group;
    for (const part of verbParts.slice(0, -1)) {
      prefix = `${prefix} ${part}`;
      let child = containers.get(prefix);
      if (!child) {
        child = node.command(part).description(`${part} commands`);
        containers.set(prefix, child);
      }
      node = child;
    }
    return node;
  };

  for (const spec of registry.all()) {
    const parent = spec.verb ? containerFor(spec) : program;
    const leaf = spec.verb ? spec.verb.split(' ').at(-1)! : spec.group;

    const argSuffix = spec.args
      .map((a) => {
        const inner = a.variadic ? `${a.name}...` : a.name;
        return a.required ? `<${inner}>` : `[${inner}]`;
      })
      .join(' ');

    const command = parent
      .command(argSuffix ? `${leaf} ${argSuffix}` : leaf)
      .description(spec.summary);

    if (spec.hidden) command.helpCommand(false);
    for (const alias of spec.aliases ?? []) command.alias(alias);

    if (spec.description || spec.examples?.length || spec.scopes?.length) {
      const sections: string[] = [];
      if (spec.description) sections.push(spec.description);
      if (spec.scopes?.length) sections.push(`Requires scope: ${spec.scopes.join(', ')}`);
      if (spec.examples?.length) {
        sections.push(`Examples:\n${spec.examples.map((e) => `  $ ${e}`).join('\n')}`);
      }
      command.addHelpText('after', `\n${sections.join('\n\n')}\n`);
    }

    for (const flag of spec.flags) {
      const signature = flagSignature(flag);
      // Phase 0 item 1 — an option that is accepted but does nothing says so
      // in its own help text. A flag that parses, validates and then silently
      // discards its value hands back a success exit code for work that never
      // happened, which is worse than the flag not existing at all.
      const description = flag.unsupported
        ? `${flag.description} [UNSUPPORTED: ${flag.unsupported}]`
        : flag.description;
      if (flag.variadic) {
        command.option(signature, description, collectRepeatable, []);
      } else if (flag.default !== undefined) {
        command.option(signature, description, flag.default as string);
      } else if (flag.required) {
        command.requiredOption(signature, description);
      } else {
        command.option(signature, description);
      }
      // `hidden` is "accepted but not advertised": keep it out of `--help`.
      if (flag.hidden) command.options.at(-1)?.hideHelp();
    }

    command.action(async (...actionArgs: unknown[]) => {
      // Commander passes positionals, then the options object, then the
      // Command. Slice by the declared arg count rather than trusting arity.
      const positionals = actionArgs.slice(0, spec.args.length);
      const rawFlags = (actionArgs[spec.args.length] ?? {}) as Record<string, unknown>;

      const args: Record<string, unknown> = {};
      spec.args.forEach((argSpec, index) => {
        args[argSpec.name] = positionals[index];
      });

      let ctx: CliContext | null = null;
      try {
        const validated = validate(spec, { args, flags: rawFlags });
        ctx = await options.createContext(spec);

        if (spec.destructive && !ctx.assumeYes) {
          const ok = await ctx.confirmDestructive(
            `${commandPath(spec)}: this cannot be undone. Continue?`,
          );
          if (!ok) {
            throw new CliError('CANCELLED', 'Aborted.', {
              hint: 'Pass --yes to skip this confirmation in scripts.',
            });
          }
        }

        const result = await spec.handler(ctx, validated);
        await options.render(spec, result);
        if (result.exitCode !== undefined && result.exitCode !== 0) {
          process.exitCode = result.exitCode;
        }
      } catch (error) {
        await options.onError(error, spec);
      } finally {
        await options.onSettled?.(spec, ctx);
        await ctx?.dispose();
      }
    });
  }
}

/**
 * Runs the spec's Zod schema over the parsed input.
 *
 * Validating here rather than in each handler means a handler can trust its
 * input, and means the SAME validation runs for the binary, the TUI palette
 * and companion RPC — three entry points that would otherwise each need their
 * own copy.
 */
export function validate<A, F>(
  spec: CommandSpec<A, F>,
  input: { args: Record<string, unknown>; flags: Record<string, unknown> },
): { args: A; flags: F } {
  if (!spec.schema) return input as unknown as { args: A; flags: F };

  const parsed = spec.schema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const [section, ...rest] = issue.path;
      const name = rest.join('.');
      const label = section === 'flags' ? flagToCli(name) : `<${name}>`;
      return `  ${label}: ${issue.message}`;
    });
    throw new CliError('VALIDATION', `Invalid arguments for \`${commandPath(spec)}\`:\n${issues.join('\n')}`, {
      hint: `Usage: generatorai ${usageLine(spec)}`,
    });
  }
  return parsed.data as { args: A; flags: F };
}
