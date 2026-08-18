// ────────────────────────────────────────────────────────────────
// CommandSpec[] → shell completion scripts.
//
// The previous CLI hand-wrote these as string literals and they had already
// drifted: `completions.ts` offered commands that no longer existed. Every
// script below is generated from the registry, and each one also delegates
// id completion back to `generatorai __complete`, so completing a run id
// asks the server instead of offering nothing.
// ────────────────────────────────────────────────────────────────

import { commandPath, flagToCli, type CommandSpec } from './CommandSpec.js';
import type { CommandRegistry } from './registry.js';

export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'nushell';

export const SHELLS: Shell[] = ['bash', 'zsh', 'fish', 'powershell', 'nushell'];

interface Entry {
  path: string;
  summary: string;
  flags: Array<{ flag: string; description: string; takesValue: boolean }>;
}

function entries(registry: CommandRegistry): Entry[] {
  return registry.visible().map((spec) => ({
    path: commandPath(spec),
    summary: spec.summary,
    flags: spec.flags
      .filter((f) => !f.hidden)
      .map((f) => ({
        flag: flagToCli(f.name),
        description: f.description,
        takesValue: f.type !== 'boolean',
      })),
  }));
}

/** Anything that would terminate the surrounding quote in a shell script. */
function esc(text: string, quote: '"' | "'" = "'"): string {
  return quote === "'"
    ? text.replace(/'/g, "'\\''")
    : text.replace(/(["`$\\])/g, '\\$1');
}

export function generateCompletions(registry: CommandRegistry, shell: Shell, binary = 'generatorai'): string {
  const list = entries(registry);
  switch (shell) {
    case 'bash':
      return bash(list, binary);
    case 'zsh':
      return zsh(list, binary);
    case 'fish':
      return fish(list, binary);
    case 'powershell':
      return powershell(list, binary);
    case 'nushell':
      return nushell(list, binary);
  }
}

function bash(list: Entry[], binary: string): string {
  const paths = list.map((e) => e.path).join('\n');
  return `# ${binary} bash completion — generated, do not edit.
# Install: ${binary} completions bash > /etc/bash_completion.d/${binary}

_${binary}_completions() {
  local cur prev line
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  line="\${COMP_LINE}"

  # Flags that name an entity get their values from the server.
  if [[ "\${prev}" == --* ]] || [[ "\${COMP_CWORD}" -gt 2 ]]; then
    local dynamic
    dynamic="$(${binary} __complete "\${line}" 2>/dev/null)"
    if [[ -n "\${dynamic}" ]]; then
      COMPREPLY=( $(compgen -W "\${dynamic}" -- "\${cur}") )
      return 0
    fi
  fi

  local commands
  commands="$(cat <<'EOF'
${paths}
EOF
)"
  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  return 0
}

complete -F _${binary}_completions ${binary}
`;
}

function zsh(list: Entry[], binary: string): string {
  const lines = list
    .map((e) => `    '${esc(e.path.replace(/ /g, '\\ '))}:${esc(e.summary)}'`)
    .join('\n');
  return `#compdef ${binary}
# generated, do not edit.

_${binary}() {
  local -a commands
  commands=(
${lines}
  )

  local -a dynamic
  dynamic=(\${(f)"$(${binary} __complete "\${words[*]}" 2>/dev/null)"})
  if (( \${#dynamic} > 0 )); then
    _describe -t values 'value' dynamic && return 0
  fi

  _describe -t commands '${binary} command' commands
}

_${binary} "$@"
`;
}

function fish(list: Entry[], binary: string): string {
  const out: string[] = [
    `# ${binary} fish completion — generated, do not edit.`,
    ``,
    `function __${binary}_dynamic`,
    `  ${binary} __complete (commandline -cp) 2>/dev/null`,
    `end`,
    ``,
  ];
  const seenGroups = new Set<string>();
  for (const entry of list) {
    const [group, ...verbs] = entry.path.split(' ');
    if (!group) continue;
    if (!seenGroups.has(group)) {
      seenGroups.add(group);
      out.push(
        `complete -c ${binary} -n '__fish_use_subcommand' -a '${group}' -d '${esc(group)} commands'`,
      );
    }
    if (verbs.length) {
      out.push(
        `complete -c ${binary} -n '__fish_seen_subcommand_from ${group}' -a '${verbs.join(' ')}' -d '${esc(entry.summary)}'`,
      );
    }
    for (const flag of entry.flags) {
      out.push(
        `complete -c ${binary} -n '__fish_seen_subcommand_from ${group}' -l '${flag.flag.replace(/^--/, '')}' -d '${esc(flag.description)}'${flag.takesValue ? ' -r' : ''}`,
      );
    }
  }
  out.push(`complete -c ${binary} -a '(__${binary}_dynamic)'`);
  return `${out.join('\n')}\n`;
}

function powershell(list: Entry[], binary: string): string {
  const rows = list
    .map((e) => `    @{ Path = '${esc(e.path)}'; Summary = '${esc(e.summary)}' }`)
    .join('\n');
  return `# ${binary} PowerShell completion — generated, do not edit.
# Install: ${binary} completions powershell | Out-File -Encoding utf8 -Append $PROFILE.CurrentUserAllHosts

Register-ArgumentCompleter -Native -CommandName ${binary} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(
${rows}
  )

  $line = $commandAst.ToString()
  $dynamic = @()
  try { $dynamic = & ${binary} __complete $line 2>$null } catch { }

  if ($dynamic -and $dynamic.Count -gt 0) {
    $dynamic | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  $commands | Where-Object { $_.Path -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_.Path, $_.Path, 'ParameterValue', $_.Summary)
  }
}
`;
}

function nushell(list: Entry[], binary: string): string {
  const rows = list
    .map((e) => `    { value: "${esc(e.path, '"')}", description: "${esc(e.summary, '"')}" }`)
    .join('\n');
  return `# ${binary} nushell completion — generated, do not edit.

def "nu-complete ${binary} commands" [] {
  [
${rows}
  ]
}

export extern "${binary}" [
  ...args: string@"nu-complete ${binary} commands"
  --json                # Machine-readable output
  --server: string      # Server URL
  --connection: string  # Named connection
  --verbose             # Debug logging
  --yes                 # Skip confirmations
]
`;
}

/**
 * The dynamic half: `generatorai __complete "<partial command line>"`.
 *
 * Returns newline-separated candidates. Shells call it on every Tab, so it
 * must stay fast and must never print an error — an error message would be
 * offered to the user as a completion candidate.
 */
export interface DynamicCompletionRequest {
  line: string;
  registry: CommandRegistry;
  /** Fetches ids for a completion source. Resolved lazily and best-effort. */
  lookup(source: string, prefix: string): Promise<string[]>;
}

export async function completeDynamic(request: DynamicCompletionRequest): Promise<string[]> {
  const tokens = request.line.trim().split(/\s+/).slice(1);
  const resolved = request.registry.resolve(tokens);
  if (!resolved) {
    // Still choosing a command: offer paths that extend what was typed.
    return request.registry
      .search(tokens.join(' '), 30)
      .map((spec) => commandPath(spec));
  }

  const { spec, rest } = resolved;
  const last = rest.at(-1) ?? '';

  // `--flag <value>` — complete the value from the flag's declared source.
  const previous = rest.at(-2) ?? '';
  if (previous.startsWith('--')) {
    const flagName = previous.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const flag = spec.flags.find((f) => f.name === flagName);
    if (flag?.choices) return flag.choices.filter((c) => c.startsWith(last));
    if (flag?.completes) return safeLookup(request, flag.completes, last);
  }

  if (last.startsWith('-')) {
    return spec.flags
      .filter((f) => !f.hidden)
      .map((f) => flagToCli(f.name))
      .filter((f) => f.startsWith(last));
  }

  // Positional: which one are we on?
  const positionalIndex = rest.filter((t) => !t.startsWith('-')).length - (last ? 1 : 0);
  const arg = spec.args[positionalIndex];
  if (arg?.completes) return safeLookup(request, arg.completes, last);

  return [];
}

async function safeLookup(
  request: DynamicCompletionRequest,
  source: string,
  prefix: string,
): Promise<string[]> {
  try {
    return await request.lookup(source, prefix);
  } catch {
    // A completion must never surface an error to the shell.
    return [];
  }
}

export type { CommandSpec };
