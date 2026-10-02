// Pure gate presentation (MB-15, MB-50; MD-31, MD-50, MD-55): the risk verdict with the client fallback, the
// category word in the header, what the permission card shows, the resolved row's words, and the approval
// target a risky answer signs.
import type { StreamBlock } from '@generatorai/client-core';
import { classifyPermissionRisk, type GateRisk, type ToolPermissionType } from '@generatorai/shared';
import { PERMISSION_GATE_COPY, PLAN_GATE_COPY, QUESTION_GATE_COPY } from '@generatorai/shared/ui-contract';

import { commandPreview, editPreview, type CommandPreview, type EditPreview } from './permissionPreview';

type PermissionBlock = Extract<StreamBlock, { type: 'permission' }>;
type QuestionBlock = Extract<StreamBlock, { type: 'question' }>;
type PlanBlock = Extract<StreamBlock, { type: 'plan' }>;

/** The server decides (MG-04); a gate raised before the flag existed gets the same shared rule (MD-31). */
export function permissionRisk(block: Pick<PermissionBlock, 'risk' | 'permissionType' | 'toolName' | 'inputSummary'>): GateRisk {
  if (block.risk) return block.risk;
  return classifyPermissionRisk({ type: block.permissionType as ToolPermissionType, toolName: block.toolName, inputSummary: block.inputSummary }).risk;
}

const CATEGORY: Record<string, string> = { shell_exec: 'Shell', network: 'Network', file_write: 'File write', file_read: 'File read' };

/** The header's end meta ("Network"), when the payload carries a category. */
export function permissionCategory(type: string): string | null {
  return CATEGORY[type] ?? null;
}

export interface PermissionView {
  /** The command (shell) or the edited path, mono. */
  code: string;
  /** The agent's own note or the server description, when it says more than the code. */
  explanation: string | null;
  edit: EditPreview | null;
}

export function permissionView(block: Pick<PermissionBlock, 'toolName' | 'inputSummary' | 'description'>): PermissionView {
  const edit = editPreview(block.toolName, block.inputSummary);
  if (edit) return { code: edit.path, explanation: block.description.trim() || null, edit };
  const command: CommandPreview | null = commandPreview(block.inputSummary);
  if (command) {
    const description = block.description.trim();
    return { code: command.command, explanation: command.note ?? (description && description !== command.command ? description : null), edit: null };
  }
  return { code: block.inputSummary || block.toolName, explanation: block.description.trim() || null, edit: null };
}

/** The one-line outcome of a settled gate ("Allowed once `git push …`", "Denied", "Answered", "Approved"). */
export function resolvedWords(
  block: PermissionBlock | QuestionBlock | PlanBlock,
): { words: string; detail?: string; tone: 'ok' | 'fg-3' } | null {
  if (block.type === 'permission') {
    if (block.status === 'allowed') return { words: `${PERMISSION_GATE_COPY.outcomeAllowed} once`, detail: permissionView(block).code, tone: 'ok' };
    if (block.status === 'denied') return { words: PERMISSION_GATE_COPY.outcomeDenied, detail: block.toolName, tone: 'fg-3' };
    if (block.status === 'expired') return { words: PERMISSION_GATE_COPY.titleExpired, tone: 'fg-3' };
    return null;
  }
  if (block.type === 'question') {
    if (block.status === 'answered') return { words: QUESTION_GATE_COPY.titleAnswered, tone: 'ok' };
    if (block.status === 'expired') return { words: QUESTION_GATE_COPY.titleExpired, tone: 'fg-3' };
    return null;
  }
  if (block.status === 'awaiting_review' || block.status === 'drafting') return null;
  const word = PLAN_GATE_COPY.status[block.status as keyof typeof PLAN_GATE_COPY.status] ?? block.status;
  return { words: `${word}: ${block.title}`, tone: block.status === 'approved' ? 'ok' : 'fg-3' };
}

/** The prompt a risky approval shows (06 §6.3: 'Approve "<gate summary>"'). */
export function approvalPrompt(decision: 'allow' | 'deny', summary: string): { title: string; subtitle: string; cancel: string } {
  const short = summary.length > 60 ? `${summary.slice(0, 57)}…` : summary;
  return decision === 'allow'
    ? { title: `Approve "${short}"?`, subtitle: 'Verify it’s you to allow this risky action.', cancel: 'Cancel' }
    : { title: `Deny "${short}"?`, subtitle: 'Verify it’s you to answer this risky request.', cancel: 'Cancel' };
}

export type ApprovalReadiness = 'checking' | 'ok' | 'missing' | 'invalidated' | 'unsupported' | 'unavailable';

/** What a risky gate's action row says and allows on this device (MD-31, MB-15). */
export function riskyActionState(readiness: ApprovalReadiness, noun: string): { canAnswer: boolean; needsRegistration: boolean; note: string } {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  switch (readiness) {
    case 'ok':
      return { canAnswer: true, needsRegistration: false, note: `${Noun} required` };
    case 'missing':
      return { canAnswer: false, needsRegistration: true, note: `Risky actions are approved with ${noun} on this device. Register once to answer.` };
    case 'invalidated':
      return { canAnswer: false, needsRegistration: true, note: `Your ${noun} or passcode changed. Register the approval key again to answer.` };
    case 'unsupported':
      return { canAnswer: false, needsRegistration: false, note: `Needs ${noun} or a passcode on this device` };
    case 'unavailable':
      return { canAnswer: false, needsRegistration: false, note: 'Update the app to approve risky actions from this device' };
    default:
      return { canAnswer: false, needsRegistration: false, note: 'Checking this device…' };
  }
}
