// ────────────────────────────────────────────────────────────────
// Gate risk (mobile MG-04, MD-31, D-106) — client-safe, pure.
//
// The server decides which approvals are risky when it creates a permission
// gate, and copies the verdict to the attention ask and the push. Risky
// approvals open the app and need a biometric-signed answer (MG-05); standard
// ones can be answered from the lock screen. Every client renders the same
// verdict (web and desktop show a "Risky" badge; their approvals stay a click).
//
// Risky (D-106): a network call; a shell command that reaches the network
// (curl, ssh, git fetch/pull/clone, package installs and publishes), pushes to
// a git remote, destroys or overwrites data (rm -r/-f, git reset --hard,
// git clean -f, a force push, dd, mkfs, kill, truncate), needs elevated rights
// (sudo, chown, chmod -R), pipes into a shell or evals, or writes outside the
// workspace (`..`, `~`, an absolute path); a shell gate whose command cannot be
// read; a file write that leaves the workspace. Every shell command used to be
// risky, so the badge carried no signal and a phone had to sign `ls`.
// ────────────────────────────────────────────────────────────────

import type { ToolPermissionType } from '../types/AgentMode.js';

export type GateRisk = 'standard' | 'risky';

export interface GateRiskInput {
  type: ToolPermissionType;
  toolName: string;
  /** The display-safe input rendering the harness supplied (a command, a path, or the input as JSON). */
  inputSummary?: string;
}

export interface GateRiskVerdict {
  risk: GateRisk;
  /** Why it is risky, as short phrases ("pushes to a git remote"); empty when standard. */
  reasons: string[];
}

// Global options before a git subcommand (`git -C repo push`, `git -c k=v push`).
const GIT = String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|-{1,2}\S+))*\s+`;
const GIT_PUSH = new RegExp(`${GIT}push\\b`);
const GIT_FORCE_PUSH = new RegExp(`${GIT}push\\b[^;&|\\n]*\\s(?:-f|--force(?:-with-lease)?)\\b`);
// A path segment that climbs out of the working directory, or a home-relative path.
const LEAVES_WORKSPACE = /(?:^|[\s"'=:(])(?:\.\.(?:[\\/]|$)|~[\\/])/;
// Starts a command (start of input or after a separator), so `xcurl` or `scurl.sh` do not match.
const CMD = String.raw`(?:^|[\s;&|(\x60$])`;

const SHELL_RULES: ReadonlyArray<{ reason: string; test: RegExp }> = [
  {
    reason: 'uses the network',
    test: new RegExp(`${CMD}(?:curl|wget|ssh|scp|sftp|rsync|nc|ncat|netcat|telnet|ftp|socat)\\b|${GIT}(?:fetch|pull|clone|ls-remote)\\b`),
  },
  {
    reason: 'downloads or publishes packages',
    test: new RegExp(
      `${CMD}(?:(?:npm|pnpm|yarn|bun)\\s+(?:install|i|add|ci|publish|update|upgrade|dlx|create)\\b|npx\\s|bunx\\s|pip3?\\s+install\\b|uv\\s+(?:pip\\s+install|add)\\b|brew\\s+install\\b|apt(?:-get)?\\s+install\\b|go\\s+(?:get|install)\\b|cargo\\s+(?:install|publish|add)\\b|gem\\s+install\\b)`,
    ),
  },
  { reason: 'pushes to a git remote', test: GIT_PUSH },
  {
    reason: 'deletes or overwrites data',
    test: new RegExp(
      `${CMD}rm\\s+(?:-[a-zA-Z]*[rRf]|--recursive|--force)|${GIT}(?:reset\\s+--hard|clean\\s+-[a-zA-Z]*f|checkout\\s+--\\s|restore\\s)|${GIT_FORCE_PUSH.source}|${CMD}(?:dd\\s+\\S*of=|mkfs|shred|truncate\\s|kill(?:all)?\\s|pkill\\s|shutdown|reboot)|>\\s*\\/dev\\/(?!null\\b)`,
    ),
  },
  { reason: 'needs elevated rights', test: new RegExp(`${CMD}(?:sudo|doas|su|chown)\\s|${CMD}chmod\\s+-[a-zA-Z]*R`) },
  { reason: 'runs code it downloads or builds at run time', test: new RegExp(`\\|\\s*(?:sudo\\s+)?(?:ba|z|da|k)?sh\\b|${CMD}eval\\s`) },
  {
    reason: 'writes outside the workspace',
    // A redirect, or a writing command, whose target is absolute, home-relative or climbs out (`/dev/null` is fine).
    test: new RegExp(
      `>>?\\s*["']?(?:\\/(?!dev\\/null\\b)|~[\\\\/]|\\.\\.[\\\\/])|${CMD}(?:cp|mv|tee|ln|touch|mkdir|install|rsync)\\b[^;&|\\n]*\\s["']?(?:\\/(?!dev\\/null\\b)|~[\\\\/]|\\.\\.[\\\\/])`,
    ),
  },
];

/**
 * The command a shell gate runs, from its input summary: the raw command, or the `command` / `cmd` field of the
 * input rendered as JSON (an argv array is joined). Undefined when there is no command to read.
 */
export function shellCommandOf(summary: string | undefined): string | undefined {
  const text = (summary ?? '').trim();
  if (!text) return undefined;
  if (!text.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const command = parsed['command'] ?? parsed['cmd'];
    if (typeof command === 'string') return command;
    if (Array.isArray(command)) return command.filter((c): c is string => typeof c === 'string').join(' ');
  } catch {
    // A summary cut off at its length cap is not valid JSON: read the field directly.
    const match = /"(?:command|cmd)"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    if (match) return match[1]!.replace(/\\(.)/g, (_m, c: string) => (c === 'n' ? '\n' : c));
  }
  return undefined;
}

/** The risk verdict for one permission gate. */
export function classifyPermissionRisk(input: GateRiskInput): GateRiskVerdict {
  const reasons: string[] = [];
  const summary = input.inputSummary ?? '';
  if (input.type === 'network') reasons.push('makes a network call');
  if (input.type === 'shell_exec') {
    const command = shellCommandOf(summary);
    if (command === undefined) reasons.push('runs a shell command it does not show');
    else for (const rule of SHELL_RULES) if (rule.test.test(command)) reasons.push(rule.reason);
  } else if (GIT_PUSH.test(summary)) {
    reasons.push('pushes to a git remote');
  }
  if (input.type === 'file_write' && LEAVES_WORKSPACE.test(summary)) reasons.push('writes outside the workspace');
  return { risk: reasons.length > 0 ? 'risky' : 'standard', reasons };
}
