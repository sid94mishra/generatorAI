// The provider's own session handle (Claude session id, Codex thread id) is
// what resumes the model's history after a restart and what a fork or rewind
// branches from. Recorded after every turn, for chats and stages (F-3b).

import type { IAgentHarness } from '../../domain/ports/IAgentHarness.js';
import type { ISessionRepository } from '../../domain/ports/IRepositories.js';

/** Best-effort and cheap: the value only changes on the first turn and after a rewind. */
export async function rememberProviderSession(
  harness: Pick<IAgentHarness, 'getProviderSessionId'>,
  sessionRepo: Pick<ISessionRepository, 'update'>,
  session: { id: string; conversationId?: string; providerSessionId?: string },
): Promise<string | undefined> {
  if (!session.conversationId) return session.providerSessionId;
  try {
    const current = harness.getProviderSessionId?.(session.conversationId);
    if (current && current !== session.providerSessionId) {
      await sessionRepo.update(session.id, { providerSessionId: current });
      return current;
    }
  } catch {
    // Never let bookkeeping break a turn.
  }
  return session.providerSessionId;
}
