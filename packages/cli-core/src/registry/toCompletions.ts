// ────────────────────────────────────────────────────────────────
// CommandSpec[] → shell completion scripts.
//
// The previous CLI hand-wrote these as string literals and they had already
// drifted: `completions.ts` offered commands that no longer existed. Every
// script below is generated from the registry, and each one also delegates
// id completion back to `generatorai __complete`, so completing a run id
// asks the server instead of offering nothing.
//
// Hierarchical completion (audit §12 Phase 2 item 6): every multi-word
// command path (`run hitl approve`, `workflow stage add`, …) must complete
// ONE WORD AT A TIME — `run <TAB>` offers `cancel hitl stage …`, not the
// full paths `run cancel`, `run hitl approve`, … all at once. `prefixMap()`
// builds that word-by-word tree once; bash/zsh/powershell serialize it as a
// native associative structure so completing a group/verb never has to spawn
// the CLI process at all — only once the input walks off the end of the
// known tree (a flag, a positional id, …) does the script fall through to
// `__complete`. fish already completed hierarchically before this change,
// but had its own bug for verbs with more than one word — see `fish()`.
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

/**
 * `prefix` (space-joined words already fully typed — `''` for the very
 * start) → the set of valid NEXT single words at that point: group names at
 * `''`, verb words under a group at `'run'`, sub-verb words at `'run
 * hitl'`, and so on. Built once from every command's full path. A caller
 * only needs to know whether it has walked off the end of this map to know
 * when to fall back to `__complete` for flags/positional args/ids — this is
 * a literal-prefix walk, not fuzzy matching (fuzzy scoring is right for the
 * TUI palette's `registry.search()`, wrong for a shell completing one exact
 * word at a time).
 */
export function prefixMap(specs: CommandSpec[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const spec of specs) {
    const words = commandPath(spec).split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const prefix = words.slice(0, i).join(' ');
      if (!map.has(prefix)) map.set(prefix, new Set());
      map.get(prefix)!.add(words[i]!);
    }
  }
  const out = new Map<string, string[]>();
  for (const [k, v] of map) out.set(k, [...v].sort());
  return out;
}

/**
 * Every completed word so far, given the raw partial command line (binary
 * name included, as every shell hands it over).
 *
 * `committed` is every word that is DONE (the group/verb/etc. already fully
 * typed); `last` is the word still being typed, `''` when the line ends in
 * whitespace (the user just finished a word and hasn't started the next
 * one). Trailing whitespace is significant and must survive here: `.trim()`
 * on the whole line collapses `"generatorai run "` and `"generatorai run"`
 * into the same tokens, which made "just finished `run`, starting a new
 * word" indistinguishable from "still typing `run`".
 */
function splitLine(line: string): { committed: string[]; last: string } {
  const withoutLeading = line.replace(/^\s+/, '');
  const words = withoutLeading === '' ? [] : withoutLeading.split(/\s+/);
  const tokens = words.slice(1); // drop the binary name
  if (tokens.length === 0) return { committed: [], last: '' };
  return { committed: tokens.slice(0, -1), last: tokens.at(-1) ?? '' };
}

/** Bash/zsh reject `''` as an associative-array subscript outright ("bad array subscript" — verified). PowerShell doesn't need it but reuses the same sentinel so all three generators agree on one convention. */
const ROOT_KEY = '@@ROOT@@';

/** Anything that would terminate the surrounding quote in a shell script. */
function esc(text: string, quote: '"' | "'" = "'"): string {
  return quote === "'"
    ? text.replace(/'/g, "'\\''")
    : text.replace(/(["`$\\])/g, '\\$1');
}

export function generateCompletions(registry: CommandRegistry, shell: Shell, binary = 'generatorai'): string {
  const list = entries(registry);
  const tree = prefixMap(registry.visible());
  switch (shell) {
    case 'bash':
      return bash(list, tree, binary);
    case 'zsh':
      return zsh(list, tree, binary);
    case 'fish':
      return fish(list, binary);
    case 'powershell':
      return powershell(list, tree, binary);
    case 'nushell':
      return nushell(list, binary);
  }
}

function bash(list: Entry[], tree: Map<string, string[]>, binary: string): string {
  const treeLines = [...tree.entries()]
    .map(([prefix, words]) => `_${binary}_TREE['${esc(prefix === '' ? ROOT_KEY : prefix)}']='${esc(words.join(' '))}'`)
    .join('\n');
  const paths = list.map((e) => e.path).join('\n');
  return `# ${binary} bash completion — generated, do not edit.
# Install: ${binary} completions bash > /etc/bash_completion.d/${binary}

# Associative arrays (\`declare -A\`) and the \`[[ -v arr[key] ]]\` existence
# test both need bash 4.2+. Stock macOS ships bash 3.2 (its last GPLv2
# release) as \`/bin/bash\`, still common as the default there — sourcing
# \`declare -A\` unconditionally on 3.2 fails at that exact line ("declare:
# -A: invalid option") and leaves every line after it, including the tree
# population below, running against a variable that was never actually
# turned into an array. Gating the whole hierarchical path behind a runtime
# version check, with a real (if flatter) fallback, means this file loads
# cleanly either way instead of just failing partway through on old bash.
if ((BASH_VERSINFO[0] >= 4)); then

declare -A _${binary}_TREE
${treeLines}

_${binary}_completions() {
  local cur cword committed key candidates dynamic i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cword=\${COMP_CWORD}
  committed=""
  for ((i = 1; i < cword; i++)); do
    if [[ -n "\${committed}" ]]; then committed+=" "; fi
    committed+="\${COMP_WORDS[i]}"
  done
  key="\${committed}"
  if [[ -z "\${key}" ]]; then key='${ROOT_KEY}'; fi

  # Still inside the known group/verb tree — no process spawn needed.
  if [[ -v _${binary}_TREE["\${key}"] ]]; then
    candidates="\${_${binary}_TREE[\${key}]}"
    COMPREPLY=( $(compgen -W "\${candidates}" -- "\${cur}") )
    return 0
  fi

  # Past the tree: a flag, a positional arg, or an id — ask the binary.
  dynamic="$(${binary} __complete "\${COMP_LINE}" 2>/dev/null)"
  COMPREPLY=( $(compgen -W "\${dynamic}" -- "\${cur}") )
  return 0
}

else

# bash < 4: no hierarchical tree, no dynamic shell-out at the cheap top
# level either (both rely on constructs this bash lacks or that would be
# awkward without them) — the same flat full-path list every shell used
# before this session's hierarchical fix, still far better than nothing.
_${binary}_completions() {
  local cur commands
  cur="\${COMP_WORDS[COMP_CWORD]}"
  commands="$(cat <<'EOF'
${paths}
EOF
)"
  COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  return 0
}

fi

complete -F _${binary}_completions ${binary}
`;
}

function zsh(list: Entry[], tree: Map<string, string[]>, binary: string): string {
  const summaryByPath = new Map(list.map((e) => [e.path, e.summary]));
  // The key must be quoted, not just the value: an unquoted `[run hitl]`
  // (a prefix with a space) would parse as two separate tokens in zsh.
  const treeLines = [...tree.entries()]
    .map(([prefix, words]) => `_${binary}_TREE['${esc(prefix === '' ? ROOT_KEY : prefix)}']="${esc(words.join(' '), '"')}"`)
    .join('\n  ');
  void summaryByPath; // reserved: per-word descriptions would need the tree to carry them too — not done here, matches the plain word list zsh already offered.
  return `#compdef ${binary}
# generated, do not edit.

typeset -gA _${binary}_TREE
${treeLines}

_${binary}() {
  local cur committed key candidates i
  cur="\${words[CURRENT]}"
  committed=""
  for ((i = 2; i < CURRENT; i++)); do
    if [[ -n "\${committed}" ]]; then committed+=" "; fi
    committed+="\${words[i]}"
  done
  key="\${committed}"
  if [[ -z "\${key}" ]]; then key='${ROOT_KEY}'; fi

  if (( \${+_${binary}_TREE[\${key}]} )); then
    local -a candidates
    candidates=(\${=_${binary}_TREE[\${key}]})
    _describe -t values 'value' candidates && return 0
  fi

  local -a dynamic
  dynamic=(\${(f)"$(${binary} __complete "\${words[*]}" 2>/dev/null)"})
  if (( \${#dynamic} > 0 )); then
    _describe -t values 'value' dynamic && return 0
  fi
  return 1
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
  // A branch word shared by several leaves (`hitl` under both `hitl
  // approve` and `hitl reject`) would otherwise get one identical `complete`
  // line per leaf that passes through it — harmless to fish (duplicate calls
  // are idempotent) but noisy; dedupe by the exact line.
  const seenLines = new Set<string>();
  const pushOnce = (line: string): void => {
    if (seenLines.has(line)) return;
    seenLines.add(line);
    out.push(line);
  };
  for (const entry of list) {
    const words = entry.path.split(' ').filter(Boolean);
    const group = words[0];
    if (!group) continue;
    if (!seenGroups.has(group)) {
      seenGroups.add(group);
      out.push(
        `complete -c ${binary} -n '__fish_use_subcommand' -a '${group}' -d '${esc(group)} commands'`,
      );
    }
    // A multi-word verb (`stage add`, `hitl approve`) must complete ONE WORD
    // AT A TIME: fish's `-a` takes a space-separated list of independent
    // candidates, so the previous `-a 'stage add'` offered "stage" and "add"
    // as siblings at the same level rather than "stage", then (once "stage"
    // is seen) "add".
    //
    // `__fish_seen_subcommand_from w1 w2` is NOT "w1 then w2 in order" — it's
    // OR across its arguments (true the moment ANY one has been typed
    // anywhere), so a single call with the whole `seenSoFar` phrase joined
    // by spaces would already be satisfied by the FIRST word alone, well
    // before the later ones were typed. `complete -n` conditions, in
    // contrast, ARE ANDed when repeated — so each word already seen gets its
    // own `-n '__fish_seen_subcommand_from <word>'`, one per word, and only
    // their conjunction gates the next word's candidates.
    for (let depth = 1; depth < words.length; depth++) {
      const seenSoFar = words.slice(0, depth);
      const nextWord = words[depth]!;
      const isLeaf = depth === words.length - 1;
      const conditions = seenSoFar
        .map((word) => `-n '__fish_seen_subcommand_from ${esc(word)}'`)
        .join(' ');
      pushOnce(
        `complete -c ${binary} ${conditions} -a '${esc(nextWord)}'${isLeaf ? ` -d '${esc(entry.summary)}'` : ''}`,
      );
    }
    const pathConditions = words
      .map((word) => `-n '__fish_seen_subcommand_from ${esc(word)}'`)
      .join(' ');
    for (const flag of entry.flags) {
      out.push(
        `complete -c ${binary} ${pathConditions} -l '${flag.flag.replace(/^--/, '')}' -d '${esc(flag.description)}'${flag.takesValue ? ' -r' : ''}`,
      );
    }
  }
  out.push(`complete -c ${binary} -a '(__${binary}_dynamic)'`);
  return `${out.join('\n')}\n`;
}

function powershell(list: Entry[], tree: Map<string, string[]>, binary: string): string {
  const summaries = list
    .map((e) => `    @{ Path = '${esc(e.path)}'; Summary = '${esc(e.summary)}' }`)
    .join('\n');
  const treeRows = [...tree.entries()]
    .map(([prefix, words]) => `  $Tree['${esc(prefix === '' ? ROOT_KEY : prefix)}'] = @('${words.map((w) => esc(w)).join("', '")}')`)
    .join('\n');
  return `# ${binary} PowerShell completion — generated, do not edit.
# Install: ${binary} completions powershell | Out-File -Encoding utf8 -Append $PROFILE.CurrentUserAllHosts

Register-ArgumentCompleter -Native -CommandName ${binary} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $Tree = @{}
${treeRows}

  $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
  # The element under the cursor is still being typed; everything before it is committed.
  $committed = if ($tokens.Count -gt 0) { ($tokens[0..($tokens.Count - 2)] -join ' ') } else { '' }
  $key = if ($committed -eq '') { '${ROOT_KEY}' } else { $committed }

  if ($Tree.ContainsKey($key)) {
    $Tree[$key] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  $line = $commandAst.ToString()
  $dynamic = @()
  try { $dynamic = & ${binary} __complete $line 2>$null } catch { }

  if ($dynamic -and $dynamic.Count -gt 0) {
    $dynamic | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  $commands = @(
${summaries}
  )
  $commands | Where-Object { $_.Path -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_.Path, $_.Path, 'ParameterValue', $_.Summary)
  }
}
`;
}

// ── Nushell ──────────────────────────────────────────────────────
//
// Left as a flat command list, NOT hierarchical, unlike bash/zsh/powershell
// above. Nushell's custom-completion functions (`def "nu-complete NAME"
// [context?]`) can in principle receive the partial command line and could
// support the same prefix-tree lookup, but this could not be verified
// against a real `nu` binary in this environment (none installed) and the
// exact context-argument contract is version-sensitive. Shipping an
// unverified nushell script that silently returns nothing (or errors) on a
// real install would be worse than the honest, already-working flat list.
// Revisit once nushell is available to test against.
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
  // Feeds `resolve()` exactly as before — unchanged so the resolved branch
  // below (rest/positional-index math) keeps its existing, already-correct
  // behavior. Trailing-whitespace-aware splitting is needed only in the
  // NOT-yet-resolved branch (see `splitLine`'s doc comment) and is computed
  // there instead of here.
  const tokens = request.line.trim().split(/\s+/).slice(1);
  const resolved = request.registry.resolve(tokens);
  if (!resolved) {
    // Still choosing a group/verb: offer only the NEXT word, not the whole
    // remaining path — `registry.search()` (fuzzy, right for the TUI
    // palette) previously returned full multi-word paths here, which is not
    // usable one word at a time by a shell.
    const { committed, last } = splitLine(request.line);
    const tree = prefixMap(request.registry.visible());
    const next = tree.get(committed.join(' ')) ?? [];
    return next.filter((w) => w.startsWith(last)).sort();
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
  if (arg?.choices) return arg.choices.filter((c) => c.startsWith(last));
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
