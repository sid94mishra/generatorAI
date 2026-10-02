import type { Chat, ChatListSummary } from '@generatorai/shared';
import type { HarnessModel } from '../domain/ports/IAgentHarness.js';

/** Display metadata is independent of readiness; unknown models keep their real id. */
export function chatModelSummary(chat: Pick<Chat, 'model' | 'harnessConfig'>, models: readonly Pick<HarnessModel, 'id' | 'name' | 'provider'>[] = []): ChatListSummary['model'] {
  const id = chat.model ?? chat.harnessConfig?.model;
  if (!id) return undefined;
  const provider = chat.harnessConfig?.harnessType;
  const model = models.find((item) => item.id === id && (!provider || item.provider === provider));
  const resolvedProvider = provider ?? model?.provider;
  return { id, label: model?.name || id, ...(resolvedProvider ? { provider: resolvedProvider } : {}) };
}
