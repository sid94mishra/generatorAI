// ────────────────────────────────────────────────────────────────
// Gate risk (mobile MG-04, MD-31) — client-safe, pure.
//
// The server decides which approvals are risky when it creates a permission
// gate, and copies the verdict to the attention ask and the push. Risky
// approvals open the app and need a biometric-signed answer (MG-05); standard
// ones can be answered from the lock screen. Every client renders the same
// verdict (web and desktop show a "Risky" badge; their approvals stay a click).
//
// Rule: a shell command, a network call, a `git push` in the input, or a file
// write that leaves the workspace (a `..` segment or a home-relative path).
// ────────────────────────────────────────────────────────────────

import type { ToolPermissionType } from '../types/AgentMode.js';

export type GateRisk = 'standard' | 'risky';

export interface GateRiskInput {
  type: ToolPermissionType;
  toolName: string;
  /** The display-safe input rendering the harness supplied (a command, a path). */
  inputSummary?: string;
}

export interface GateRiskVerdict {
  risk: GateRisk;
  /** Why it is risky, as short phrases ("runs a shell command"); empty when standard. */
  reasons: string[];
}

// `git push`, also behind global options (`git -C repo push`, `git -c k=v push`).
const GIT_PUSH = /\bgit(?:\s+(?:-[Cc]\s+\S+|-{1,2}\S+))*\s+push\b/;
// A path segment that climbs out of the working directory, or a home-relative path.
const LEAVES_WORKSPACE = /(?:^|[\s"'=:(])(?:\.\.(?:[\\/]|$)|~[\\/])/;

/** The risk verdict for one permission gate. */
export function classifyPermissionRisk(input: GateRiskInput): GateRiskVerdict {
  const reasons: string[] = [];
  const summary = input.inputSummary ?? '';
  if (input.type === 'shell_exec') reasons.push('runs a shell command');
  if (input.type === 'network') reasons.push('makes a network call');
  if (GIT_PUSH.test(summary)) reasons.push('pushes to a git remote');
  if (input.type === 'file_write' && LEAVES_WORKSPACE.test(summary)) reasons.push('writes outside the workspace');
  return { risk: reasons.length > 0 ? 'risky' : 'standard', reasons };
}
