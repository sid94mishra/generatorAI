// MB-41 ContextUsage model (pure): "42% of context used", "84.2K / 200K tokens", the breakdown rows.
import { formatTokenLimit, type ContextUsageSnapshot } from '@generatorai/client-core';

const LABELS: Record<string, string> = {
  system: 'System prompt',
  tools: 'Tools',
  mcpTools: 'MCP tools',
  memoryFiles: 'Memory files',
  conversation: 'Conversation',
  toolCalls: 'Tool calls',
  toolResults: 'Tool results',
  attachments: 'Attachments',
  userMessages: 'Your messages',
  assistantMessages: 'Agent messages',
  skills: 'Skills',
  agents: 'Agents',
};

export interface ContextUsageView {
  ratio: number;
  percent: number;
  title: string;
  tokens: string;
  breakdown: Array<{ label: string; value: string }>;
  api: Array<{ label: string; value: string }>;
}

/** Null when nothing is known yet (no snapshot, or no limit to measure against). */
export function contextUsageView(usage: Pick<ContextUsageSnapshot, 'currentTokens' | 'promptTokenLimit' | 'breakdown' | 'apiUsage'> | null | undefined, limit?: number | null): ContextUsageView | null {
  const denominator = usage?.promptTokenLimit ?? limit ?? null;
  if (!usage || !denominator || denominator <= 0) return null;
  const ratio = Math.min(1, Math.max(0, usage.currentTokens / denominator));
  const percent = Math.round(ratio * 100);
  const entries = Object.entries(usage.breakdown ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0);
  const api = usage.apiUsage ?? {};
  return {
    ratio,
    percent,
    title: `${percent}% of context used`,
    tokens: `${formatTokenLimit(usage.currentTokens)} / ${formatTokenLimit(denominator)} tokens`,
    breakdown: entries.sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ label: LABELS[key] ?? key, value: formatTokenLimit(value) })),
    api: [
      ['Input', api.input],
      ['Output', api.output],
      ['Cache read', api.cacheRead],
      ['Cache write', api.cacheWrite],
    ]
      .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
      .map(([label, value]) => ({ label, value: formatTokenLimit(value) })),
  };
}
