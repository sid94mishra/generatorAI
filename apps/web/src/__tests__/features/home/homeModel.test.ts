import { describe, expect, it } from 'vitest';
import type { AttentionAsk, AttentionItem } from '@generatorai/shared';
import { chatNameFromPrompt } from '@generatorai/shared/ui-contract';
import {
  formatBytes,
  formatDuration,
  formatUptime,
  homeHeadline,
  needsYouActions,
  weekRange,
} from '@/features/home/homeModel.js';

const ask = (kind: AttentionAsk['kind'], actions: AttentionAsk['actions']): AttentionAsk => ({ kind, id: 'a1', summary: 's', actions });
const item = (entity: AttentionItem['entity'], a: AttentionAsk): Pick<AttentionItem, 'entity' | 'ask'> => ({ entity, ask: a });

describe('homeHeadline', () => {
  it('counts needs-you and running, and says so when nothing needs you', () => {
    expect(homeHeadline(undefined)).toBeUndefined();
    expect(homeHeadline({ needsYou: 2, running: 3 })).toBe('2 need you · 3 running');
    expect(homeHeadline({ needsYou: 1, running: 0 })).toBe('1 needs you');
    expect(homeHeadline({ needsYou: 0, running: 1 })).toBe('Nothing needs you · 1 running');
    expect(homeHeadline({ needsYou: 0, running: 0 })).toBe('Nothing needs you');
  });
});

describe('needsYouActions', () => {
  it('offers Allow once only for a chat tool permission the server allows', () => {
    expect(needsYouActions(item('chat', ask('tool_permission', ['allow_once', 'deny', 'open'])))).toEqual({
      primary: { action: 'allow_once', label: 'Allow once' },
      openLabel: 'Open',
    });
    expect(needsYouActions(item('chat', ask('tool_permission', ['open'])))).toEqual({ openLabel: 'Open' });
  });

  it('offers Approve for a chat plan review and a workflow stage approval', () => {
    expect(needsYouActions(item('chat', ask('plan_review', ['approve', 'reject', 'open']))).primary?.action).toBe('approve');
    expect(needsYouActions(item('workflow_run', ask('stage_approval', ['approve', 'reject', 'open']))).primary?.action).toBe('approve');
    expect(needsYouActions(item('workflow_run', ask('stage_approval', ['approve']))).openLabel).toBe('Review');
  });

  it('never answers questions, inputs, consent or paused runs inline', () => {
    expect(needsYouActions(item('chat', ask('question', ['answer', 'open'])))).toEqual({ openLabel: 'Answer' });
    expect(needsYouActions(item('workflow_run', ask('stage_input', ['answer', 'open'])))).toEqual({ openLabel: 'Answer' });
    expect(needsYouActions(item('chat', ask('computer_consent', ['allow_once', 'deny', 'open'])))).toEqual({ openLabel: 'Open' });
    expect(needsYouActions(item('workflow_run', ask('run_paused', ['open'])))).toEqual({ openLabel: 'Review' });
  });
});

describe('weekRange', () => {
  it('starts on the locale first day at local midnight and spans seven days', () => {
    // Saturday 26 Sep 2026, 14:12 local.
    const sat = new Date(2026, 8, 26, 14, 12);
    const monday = weekRange(sat, 1);
    expect(monday.from).toEqual(new Date(2026, 8, 21));
    expect(monday.to).toEqual(new Date(2026, 8, 28));
    const sunday = weekRange(sat, 7);
    expect(sunday.from).toEqual(new Date(2026, 8, 20));
    // On the first day itself the week starts today.
    expect(weekRange(new Date(2026, 8, 21, 0, 5), 1).from).toEqual(new Date(2026, 8, 21));
    // Sunday with a Monday start belongs to the week that began six days earlier.
    expect(weekRange(new Date(2026, 8, 27, 9), 1).from).toEqual(new Date(2026, 8, 21));
  });
});

describe('formatters', () => {
  it('formats durations, uptimes and sizes', () => {
    expect(formatDuration(372_000)).toBe('6m 12s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    expect(formatUptime(3 * 86400 + 4 * 3600 + 12 * 60)).toBe('3d 4h 12m');
    expect(formatUptime(59)).toBe('0m');
    expect(formatBytes(212_000_000)).toBe('212 MB');
    expect(formatBytes(1_400_000_000)).toBe('1.4 GB');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('names a chat from the first line of its prompt', () => {
    expect(chatNameFromPrompt('  Fix the flaky test\nmore detail')).toBe('Fix the flaky test');
    const long = 'Refactor the pricing module so that every discount rule is evaluated in one place';
    const name = chatNameFromPrompt(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('…')).toBe(true);
  });
});
