// Pure AttentionList rules (03 MB-19; MD-34, MD-59): the drawer's trailing ask hint, overflow, row labels. Unit-tested.
import type { AttentionItem } from '@generatorai/shared';

/** Rows a drawer section shows before "Show all (N)" (03 ML-06). */
export const DRAWER_LIMIT = 5;

/** The short trailing hint of a Needs you row: the ask's verb or the command ("Approve", "git push", "Plan"). */
export function askHint(item: Pick<AttentionItem, 'ask'>): string | undefined {
  const ask = item.ask;
  if (!ask) return undefined;
  switch (ask.kind) {
    case 'plan_review':
      return 'Plan';
    case 'question':
      return 'Answer';
    case 'stage_approval':
      return 'Approve';
    case 'stage_input':
      return 'Input';
    case 'computer_consent':
      return 'Consent';
    case 'run_paused':
      return 'Paused';
    case 'tool_permission': {
      // The command's first two words carry it ("git push -u origin x" → "git push"); otherwise the verb.
      const words = (ask.detail ?? '').trim().split(/\s+/).filter(Boolean);
      return words.length ? words.slice(0, 2).join(' ') : 'Allow';
    }
    default:
      return undefined;
  }
}

/** The first `limit` rows and how many there are in all (the "Show all (N)" row appears when more remain). */
export function sectionRows<T>(items: readonly T[], limit = DRAWER_LIMIT): { rows: readonly T[]; total: number; overflow: boolean } {
  return { rows: items.slice(0, limit), total: items.length, overflow: items.length > limit };
}

/** "Nightly dependency audit, needs you, Approve" (03 MB-19 a11y). */
export function attentionLabel(item: Pick<AttentionItem, 'title' | 'state' | 'ask'>, elapsed?: string): string {
  const state = item.state === 'needs_you' ? 'needs you' : item.state === 'running' ? 'running' : item.state.replace('_', ' ');
  return [item.title, state, item.state === 'needs_you' ? item.ask?.summary ?? askHint(item) : elapsed].filter(Boolean).join(', ');
}
