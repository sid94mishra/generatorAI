import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_CHANNELS,
  RETIRED_NOTIFICATION_CHANNELS,
  isNotificationCategoryId,
} from '../notifications.js';

describe('notification vocabulary v2 (mobile 06 §7.2)', () => {
  it('defines every category once, on an existing channel', () => {
    const channels = new Set(NOTIFICATION_CHANNELS.map((c) => c.id));
    for (const id of NOTIFICATION_CATEGORY_IDS) {
      expect(NOTIFICATION_CATEGORIES[id].id).toBe(id);
      expect(channels.has(NOTIFICATION_CATEGORIES[id].channel)).toBe(true);
    }
    expect(RETIRED_NOTIFICATION_CHANNELS.some((id) => channels.has(id as never))).toBe(false);
  });

  it('answers in the background only for an ordinary permission and a reply (MD-31)', () => {
    const background = NOTIFICATION_CATEGORY_IDS.flatMap((id) =>
      NOTIFICATION_CATEGORIES[id].actions.filter((a) => a.kind !== 'foreground').map((a) => `${id}:${a.id}`),
    );
    expect(background).toEqual(['approval:approve', 'approval:deny', 'question:reply']);
    expect(NOTIFICATION_CATEGORIES['approval.risky'].actions.map((a) => a.kind)).toEqual(['foreground']);
  });

  it('keeps lock-screen titles free of commands and only completions passive', () => {
    for (const id of NOTIFICATION_CATEGORY_IDS) expect(NOTIFICATION_CATEGORIES[id].redactedTitle).not.toMatch(/[/`$]/);
    expect(NOTIFICATION_CATEGORY_IDS.filter((id) => NOTIFICATION_CATEGORIES[id].interruption === 'passive')).toEqual(['done']);
    expect(isNotificationCategoryId('completed')).toBe(false);
  });
});
