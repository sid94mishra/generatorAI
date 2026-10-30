// ────────────────────────────────────────────────────────────────
// Who answers in a stage, named the way the chat names who answers (D-172):
// the bound agent ("Pulse QA Engineer is thinking"), else the provider the
// stage pins ("Codex is thinking"), else plain "Agent". Never the stage's own
// name — "Report is thinking" read as if the stage were the agent.
// ────────────────────────────────────────────────────────────────

import { harnessProviderLabel } from '@generatorai/shared/ui-contract';
import { useAgents } from '@/hooks/agentQueries.js';
import type { StageView } from '../model/types.js';

export interface StageAgent {
  /** The header name and the subject of "… is thinking". */
  name: string;
  /** The provider whose logo is the avatar — only when no agent is bound, as in the chat. */
  harnessProvider: string | undefined;
}

/** `project:pulse-qa-engineer` → `Pulse qa engineer` until the agent list arrives. */
function nameFromRef(ref: string): string {
  const slug = ref
    .slice(ref.indexOf(':') + 1)
    .replace(/[-_]+/g, ' ')
    .trim();
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Agent';
}

export function useStageAgent(stage: Pick<StageView, 'agentRef' | 'harnessType'>): StageAgent {
  const { data: agents } = useAgents();
  if (stage.agentRef) {
    const agent = agents?.find((a) => a.ref === stage.agentRef);
    return { name: agent?.name ?? nameFromRef(stage.agentRef), harnessProvider: undefined };
  }
  if (stage.harnessType) return { name: harnessProviderLabel(stage.harnessType), harnessProvider: stage.harnessType };
  return { name: 'Agent', harnessProvider: undefined };
}
