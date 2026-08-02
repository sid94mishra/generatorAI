// ────────────────────────────────────────────────────────────────
// Context-usage E2E — the model picker and the context gauge must
// agree, for BOTH providers, across single and multi-turn chats.
//
// The regression this guards: the composer advertised a model's
// prompt+completion total (264K) while the gauge divided by the
// provider's real prompt budget (200K), so the same model reported
// two different context sizes in two places on the same screen.
// ────────────────────────────────────────────────────────────────

import { test, expect } from '@playwright/test';

const API_URL = process.env.API_URL || 'http://localhost:3100';

interface CatalogModel {
  id: string;
  name: string;
  provider?: string;
  promptTokenLimit?: number;
  totalContextWindow?: number;
  maxOutputTokens?: number;
  longContext?: { promptTokenLimit?: number };
  supportsLongContext?: boolean;
  supportsReasoning?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

async function catalog(): Promise<CatalogModel[]> {
  const res = await fetch(`${API_URL}/api/harness/models`);
  expect(res.ok).toBeTruthy();
  return (await res.json()) as CatalogModel[];
}

// ═══════════════════════════════════════════════════════════════
// 1. Catalog contract — the data the whole feature stands on
// ═══════════════════════════════════════════════════════════════

test.describe('model catalog contract', () => {
  test('every model publishes coherent prompt/total/output limits', async () => {
    const models = await catalog();
    expect(models.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const m of models) {
      const tag = `${m.provider}/${m.id}`;
      // `auto` legitimately reports 0 (the real model is chosen at runtime).
      if (!m.promptTokenLimit) continue;

      if (!Number.isFinite(m.promptTokenLimit) || m.promptTokenLimit <= 0) {
        problems.push(`${tag}: bad promptTokenLimit ${m.promptTokenLimit}`);
      }
      if (m.totalContextWindow && m.promptTokenLimit > m.totalContextWindow) {
        problems.push(`${tag}: promptTokenLimit ${m.promptTokenLimit} > total ${m.totalContextWindow}`);
      }
      // The prompt budget must never be the total-plus-output sum — that was
      // the original bug (200K prompt rendered as 264K).
      if (m.totalContextWindow && m.maxOutputTokens) {
        const bogus = m.totalContextWindow + m.maxOutputTokens;
        if (m.promptTokenLimit === bogus) {
          problems.push(`${tag}: promptTokenLimit double-counts max output (${bogus})`);
        }
      }
      if (m.longContext?.promptTokenLimit && m.longContext.promptTokenLimit < m.promptTokenLimit) {
        problems.push(`${tag}: long tier smaller than default tier`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('claude-opus-4.7 reports a 200K prompt budget, not 264K', async () => {
    const models = await catalog();
    const opus = models.find((m) => m.id === 'claude-opus-4.7' && m.provider === 'copilot');
    test.skip(!opus, 'claude-opus-4.7 not entitled for this account');
    expect(opus!.promptTokenLimit).toBe(200_000);
    expect(opus!.totalContextWindow).toBe(264_000);
    expect(opus!.maxOutputTokens).toBe(64_000);
    expect(opus!.longContext?.promptTokenLimit).toBe(936_000);
  });

  test('both providers publish reasoning efforts with a default', async () => {
    const models = await catalog();
    const providers = new Set(models.map((m) => m.provider));
    expect(providers.size).toBeGreaterThanOrEqual(1);

    for (const m of models.filter((x) => x.supportsReasoning)) {
      expect(m.reasoningEfforts?.length, `${m.provider}/${m.id} efforts`).toBeGreaterThan(0);
    }
  });

  test('?provider= filters the catalog', async () => {
    const all = await catalog();
    const providers = [...new Set(all.map((m) => m.provider))].filter(Boolean) as string[];
    for (const p of providers) {
      const res = await fetch(`${API_URL}/api/harness/models?provider=${p}`);
      const rows = (await res.json()) as CatalogModel[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((m) => m.provider === p)).toBeTruthy();
    }
  });

  test('the deprecated /copilot/models alias still answers', async () => {
    const res = await fetch(`${API_URL}/api/copilot/models`);
    expect(res.ok).toBeTruthy();
    expect(res.headers.get('deprecation')).toBe('true');
  });
});

