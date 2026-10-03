// The transcript's actions (MB-07). They live on a context rather than on each row so a memoised row in the
// virtualised list never re-renders because a callback was recreated; the screen owns sheets, mutations, the
// composer draft and navigation, and a row only says what was tapped.
import { createContext, useContext, type ReactElement } from 'react';
import type { StreamSegment, TimelineStep } from '@generatorai/client-core';

export type GateSegment = Extract<StreamSegment, { type: 'permission' | 'question' | 'plan' }>;

export interface TranscriptActions {
  /** The bound agent (AgentTurnHeader); null for model-only chats (MChatNoAgent). */
  agent: { name: string; role?: 'agent' | 'orchestrator' } | null;
  /** The chat's model display label (MG-03), shown after the agent or alone. */
  model: string | null;
  /** Step detail (MB-14) for a tool call. */
  onOpenStep?: (callId: string) => void;
  /** A worker's own chat (DelegationGroup, MB-17). */
  onOpenChat?: (chatId: string) => void;
  /** The pane's Tasks tab ("Open ›"). */
  onOpenTasks?: () => void;
  /** A web-shaped in-app href (workflow run cards); the screen validates and routes it. */
  onOpenHref?: (href: string) => void;
  /** An allowed `generatorai://` link inside assistant text. */
  onOpenLink?: (href: string) => void;
  /** A screenshot a step produced (workspace-relative). */
  onOpenImage?: (image: NonNullable<TimelineStep['image']>) => void;
  onRewind?: (turnId: string, prompt: string) => void;
  onForkFrom?: (turnId: string) => void;
  onCopyTranscript?: () => void;
  /** Absent when text to speech is unavailable. */
  onReadAloud?: (text: string) => void;
  /** MB-18 DraftCard "Publish" (people with `write:workflows` only); resolves once published, rejects otherwise. */
  onPublishDraft?: (workflowId: string) => Promise<void>;
  /** Gate segments (MB-15): the screen renders the card; without it a settled gate shows its one-line outcome. */
  renderGate?: (segment: GateSegment) => ReactElement | null;
}

export const TranscriptActionsContext = createContext<TranscriptActions>({ agent: null, model: null });

export function useTranscriptActions(): TranscriptActions {
  return useContext(TranscriptActionsContext);
}
