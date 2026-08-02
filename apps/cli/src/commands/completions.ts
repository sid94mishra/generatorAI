// completions command — generate shell completions for bash, zsh, fish, powershell

import type { Command } from 'commander';
import chalk from 'chalk';

// Keep these in sync with `registerAllCommands` + per-command subcommands.
// Adding a new top-level command? Update TOP_LEVEL + (optionally) SUBCOMMANDS.
const TOP_LEVEL = [
  'system', 'health', 'models', 'copilot', 'config', 'chat',
  'workflow', 'wf', 'run', 'orchestrator', 'orch', 'automation', 'auto',
  'project', 'proj', 'workspace', 'ws', 'webhook', 'hook', 'harness',
  'script', 'sc', 'init', 'completions', 'tui',
];

const SUBCOMMANDS: Record<string, string[]> = {
  system: ['health', 'health-config', 'models', 'status', 'artifacts', 'mcp-servers'],
  config: ['show', 'set', 'get', 'edit', 'reset', 'profile'],
  copilot: ['conversations', 'messages', 'ping'],
  profile: ['list', 'create', 'use', 'delete'],
  chat: ['list', 'create', 'show', 'send', 'messages', 'watch', 'delete'],
  workflow: ['list', 'create', 'show', 'update', 'delete', 'validate', 'export', 'import', 'stage', 'edge', 'from-template', 'template'],
  wf: ['list', 'create', 'show', 'update', 'delete', 'validate', 'export', 'import', 'stage', 'edge', 'from-template', 'template'],
  run: ['list', 'start', 'show', 'watch', 'messages', 'pause', 'resume', 'cancel', 'retry', 'hitl', 'stage', 'profile', 'workspace'],
  orchestrator: ['templates', 'template', 'create', 'start', 'context', 'cancel'],
  orch: ['templates', 'template', 'create', 'start', 'context', 'cancel'],
  automation: ['list', 'create', 'show', 'enable', 'disable', 'trigger', 'delete', 'executions', 'rotate-token', 'cancel-execution'],
  auto: ['list', 'create', 'show', 'enable', 'disable', 'trigger', 'delete', 'executions', 'rotate-token', 'cancel-execution'],
  project: ['list', 'create', 'show', 'update', 'delete', 'codebase', 'cb', 'artifacts'],
  proj: ['list', 'create', 'show', 'update', 'delete', 'codebase', 'cb', 'artifacts'],
  codebase: ['list', 'link', 'unlink'],
  cb: ['list', 'link', 'unlink'],
  workspace: ['list', 'show', 'archive', 'commit', 'delete', 'cleanup'],
  ws: ['list', 'show', 'archive', 'commit', 'delete', 'cleanup'],
  webhook: ['list', 'create', 'delete'],
  hook: ['phases', 'test'],
  harness: ['show', 'switch'],
  script: ['list', 'show', 'profiles', 'validate', 'materialize', 'run', 'reload'],
  sc: ['list', 'show', 'profiles', 'validate', 'materialize', 'run', 'reload'],
  stage: ['add', 'update', 'delete'],
  edge: ['add', 'delete'],
  template: ['list', 'create', 'config'],
  hitl: ['mode', 'pending', 'resume'],
};

function bashCases(): string {
  return Object.entries(SUBCOMMANDS)
    .map(([cmd, subs]) => `    ${cmd}) COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") ) ;;`)
    .join('\n');
}

const BASH_COMPLETION = `#!/bin/bash
# GeneratorAI CLI bash completion
_generatorai_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="${TOP_LEVEL.join(' ')}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  case "$prev" in
${bashCases()}
  esac
}
complete -F _generatorai_completions generatorai
`;

function zshSubCases(): string {
  return Object.entries(SUBCOMMANDS)
    .map(([cmd, subs]) => `      ${cmd}) compadd ${subs.join(' ')} ;;`)
    .join('\n');
}

const ZSH_COMPLETION = `#compdef generatorai
# GeneratorAI CLI zsh completion
_generatorai() {
  local -a commands=(
${TOP_LEVEL.map((c) => `    '${c}'`).join('\n')}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  local prev="\${words[CURRENT-1]}"
  case "$prev" in
${zshSubCases()}
  esac
}
_generatorai "$@"
`;

function fishLines(): string {
  const top = TOP_LEVEL.map(
    (c) => `complete -c generatorai -n '__fish_use_subcommand' -a ${c}`,
  ).join('\n');
  const subs = Object.entries(SUBCOMMANDS)
    .map(
      ([cmd, list]) =>
        `complete -c generatorai -n '__fish_seen_subcommand_from ${cmd}' -a '${list.join(' ')}'`,
    )
    .join('\n');
  return `${top}\n${subs}`;
}

const FISH_COMPLETION = `# GeneratorAI CLI fish completion
${fishLines()}
`;

const POWERSHELL_COMPLETION = `# GeneratorAI CLI PowerShell completion
Register-ArgumentCompleter -CommandName generatorai -ScriptBlock {
  param($commandName, $wordToComplete, $cursorPosition)
  $commands = @(${TOP_LEVEL.map((c) => `'${c}'`).join(',')})
  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;

export function registerCompletionsCommand(program: Command): void {
  program
    .command('completions')
    .description('Generate shell completions')
    .argument('<shell>', 'Shell type: bash, zsh, fish, powershell')
    .action((shell: string) => {
      switch (shell.toLowerCase()) {
        case 'bash':
          process.stdout.write(BASH_COMPLETION);
          break;
        case 'zsh':
          process.stdout.write(ZSH_COMPLETION);
          break;
        case 'fish':
          process.stdout.write(FISH_COMPLETION);
          break;
        case 'powershell':
        case 'pwsh':
          process.stdout.write(POWERSHELL_COMPLETION);
          break;
        default:
          process.stderr.write(chalk.red(`\n  ✗ Unknown shell: ${shell}\n`));
          process.stderr.write(chalk.dim('  Supported: bash, zsh, fish, powershell\n\n'));
          process.exitCode = 1;
      }
    });
}
