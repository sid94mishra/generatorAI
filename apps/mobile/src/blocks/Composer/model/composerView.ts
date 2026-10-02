// Pure Composer presentation (MB-01; MD-03, MD-56, MD-57, MD-63): the primary control, the placeholder, the "+"
// menu and the suggestion groups. Kept apart from the component so the rules are unit-tested.
import type { MobileIconConcept } from '@generatorai/design-tokens';

import { TERMINAL_CAPTURE_LINES } from './captures';
import type { SlashItem, StopState } from './types';

export type PrimaryKind = 'send' | 'stop' | 'stopping' | 'force';

/** Send while idle; while a turn is live the two-phase Stop (inert 400 ms, Force reset after 15 s, MD-03). */
export function composerPrimary(isStreaming: boolean, stop: StopState | undefined): PrimaryKind {
  if (!isStreaming) return 'send';
  if (stop?.forceAvailable) return 'force';
  if (stop && !stop.enabled) return 'stopping';
  return 'stop';
}

/** "Reply to <agent>…" / "Message <model>…" — the same while running, never "Queue…" (MD-03, D-29). */
export function composerPlaceholder(input: {
  disabled: boolean;
  gated: boolean;
  argHint?: string | undefined;
  placeholder?: string | undefined;
  agent?: string | null | undefined;
  model?: string | null | undefined;
}): string {
  if (input.disabled && !input.gated) return 'Waiting…';
  if (input.argHint) return input.argHint;
  if (input.placeholder) return input.placeholder;
  if (input.agent) return `Reply to ${input.agent}…`;
  if (input.model) return `Message ${input.model}…`;
  return 'Message…';
}

/** The field's spoken name ("Message Bug Fixer"). */
export function composerLabel(agent?: string | null, model?: string | null): string {
  return agent ? `Message ${agent}` : model ? `Message ${model}` : 'Message';
}

export type PlusItem =
  | { id: string; label: string; icon: MobileIconConcept; subtitle?: string; disabled?: boolean; children?: PlusItem[] }
  | { type: 'separator' };

/**
 * The "+" menu (MD-63): Attach file · Photo library · Camera | Screenshot of browser · Terminal output (only where a
 * capture source exists) · Paste from clipboard | Commands & skills ("/") · Mention file ("@") | Recent prompts.
 * File items are disabled with the reason when this device may not upload; "Request file access" then appears.
 */
export function plusMenu(input: {
  attachAvailable: boolean;
  attachDisabledReason?: string | undefined;
  attachGrantable?: boolean | undefined;
  browser: boolean;
  terminal: boolean;
  terminalSelection: number | null;
  history: boolean;
}): PlusItem[] {
  const off = !input.attachAvailable;
  const reason = off ? (input.attachDisabledReason ?? 'Attachments are not permitted on this device.') : undefined;
  const file = (id: string, label: string, icon: MobileIconConcept): PlusItem => ({ id, label, icon, ...(off ? { disabled: true, subtitle: reason } : {}) });
  const items: PlusItem[] = [file('file', 'Attach file', 'file'), file('photo', 'Photo library', 'image'), file('camera', 'Camera', 'camera'), { type: 'separator' }];
  if (input.browser) {
    items.push({
      id: 'browser',
      label: 'Screenshot of browser',
      icon: 'browser',
      children: [file('browser-screenshot', 'Screenshot', 'camera'), { id: 'browser-text', label: 'Page text', icon: 'file-text' }],
    });
  }
  if (input.terminal) {
    items.push({
      id: 'terminal',
      label: 'Terminal output',
      icon: 'terminal',
      children: [
        ...TERMINAL_CAPTURE_LINES.map((n): PlusItem => ({ id: `terminal-${n}`, label: `Last ${n} lines`, icon: 'terminal' })),
        input.terminalSelection
          ? { id: 'terminal-selection', label: 'Current selection', icon: 'copy', subtitle: `${input.terminalSelection.toLocaleString()} characters` }
          : { id: 'terminal-selection', label: 'Current selection', icon: 'copy', disabled: true, subtitle: 'Long-press text in the Terminal tab first' },
      ],
    });
  }
  items.push(file('clipboard', 'Paste from clipboard', 'copy'));
  if (off && input.attachGrantable !== false) items.push({ id: 'request-access', label: 'Request file access', icon: 'key' });
  items.push({ type: 'separator' }, { id: 'slash', label: 'Commands & skills', icon: 'skills' }, { id: 'mention', label: 'Mention file', icon: 'mention' });
  if (input.history) items.push({ type: 'separator' }, { id: 'history', label: 'Recent prompts', icon: 'history' });
  return items;
}

export type SuggestionGroup = { title: string; items: SlashItem[] };

const GROUP: Record<SlashItem['kind'], string> = { command: 'Tools', navigate: 'Tools', skill: 'Skills', prompt: 'Prompts', agent: 'Agents', file: 'Files' };
const ORDER = ['Tools', 'Skills', 'Prompts', 'Agents', 'Files'];

/** The slash / mention popover's groups (MComposerInput: Tools, Skills, Prompts), in a fixed order. */
export function suggestionGroups(items: readonly SlashItem[]): SuggestionGroup[] {
  const map = new Map<string, SlashItem[]>();
  for (const item of items) {
    const title = GROUP[item.kind];
    map.set(title, [...(map.get(title) ?? []), item]);
  }
  return ORDER.filter((t) => map.has(t)).map((title) => ({ title, items: map.get(title)! }));
}

/** The suggestion's type tag ("tool", "skill", "prompt"). */
export function suggestionTag(item: SlashItem): string {
  return item.kind === 'navigate' || item.kind === 'command' ? 'tool' : item.kind;
}
