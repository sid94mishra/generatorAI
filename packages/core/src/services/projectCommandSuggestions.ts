// ────────────────────────────────────────────────────────────────
// The commands a project's agents run all the time — its test, lint,
// typecheck and build scripts — offered for "run without asking" on the
// project's settings (D-157). In the evaluation every run asked for them
// again; allowed for the project, no chat or stage of it asks.
//
// Read from each codebase's package.json (its committed default branch,
// else the folder on disk), with the package manager its lockfile names. A
// suggestion is offered only when its rule is exactly that command: `npm run
// lint` would be remembered as `npm run`, which allows every script, so npm
// gets only `npm test`.
// ────────────────────────────────────────────────────────────────

import { shellCommandRules } from '@generatorai/shared';

/** The scripts worth allowing: tests, lint, types, build, format (and `name:variant` forms). */
const SCRIPT_PATTERN = /^(test|lint|typecheck|type-check|check|build|format)(:[\w:-]+)?$/;
const MAX_SUGGESTIONS = 12;

export interface CommandSuggestion {
  command: string;
  /** Where it came from: `<codebase alias>/package.json`. */
  source: string;
}

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

/** The package manager a lockfile names (npm without one). */
export function packageManagerOf(files: readonly string[]): PackageManager {
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  if (files.includes('bun.lockb') || files.includes('bun.lock')) return 'bun';
  return 'npm';
}

/** The commands a package.json's scripts suggest, each one rule that is exactly the command. */
export function commandSuggestions(packageJson: string, manager: PackageManager, source: string): CommandSuggestion[] {
  let scripts: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: unknown };
    scripts = parsed.scripts && typeof parsed.scripts === 'object' ? (parsed.scripts as Record<string, unknown>) : {};
  } catch {
    return [];
  }
  const out: CommandSuggestion[] = [];
  for (const name of Object.keys(scripts).filter((n) => SCRIPT_PATTERN.test(n)).sort()) {
    const command = manager === 'npm' ? (name === 'test' ? 'npm test' : null) : `${manager} ${name}`;
    if (!command) continue;
    const { rules } = shellCommandRules(command);
    if (rules.length === 1 && rules[0]!.match === command) out.push({ command, source });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
