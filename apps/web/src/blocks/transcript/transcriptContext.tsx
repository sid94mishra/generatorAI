// ────────────────────────────────────────────────────────────────
// Transcript context — the click-throughs, gate handlers and host slots a
// transcript surface provides to every part inside it (B-14…B-24).
//
// A context rather than props: steps, cards and prose are pure data shared by
// several surfaces (the chat, the Tasks dock "Last steps", a workflow stage),
// and threading a dozen callbacks through every one of them would couple all
// of those surfaces to the chat page's dock wiring. A surface that provides
// nothing renders a read-only transcript: no action icons, inert gate cards.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext, type ReactNode } from 'react';
import type { ScmResultBlock, WidgetBlock } from '@generatorai/client-core';
import type { TranscriptViewMode } from '@generatorai/shared/ui-contract';

export type PlanApproval = 'implement_interactive' | 'implement_autopilot';

export interface TranscriptActions {
  /** Open the Changes dock tab (optionally at one file). */
  onOpenChanges?: (filePath?: string) => void;
  /** Open the terminal's agent-command console at one shell call. */
  onOpenShell?: (callId: string) => void;
  /** Focus the Browser dock tab (browser tool rows). */
  onOpenBrowser?: () => void;
  /** Focus the Tasks dock tab (delegation group "Open in dock"). */
  onOpenTasks?: () => void;
  /** Open a plan in the Plan dock tab. */
  onOpenPlan?: (planId: string) => void;
  onApprovePlan?: (planId: string, action: PlanApproval) => void;
  onRequestPlanChanges?: (planId: string, feedback: string) => void;
  onAnswerQuestion?: (interactionId: string, answers: Record<string, string[]>, freeformResponse?: string) => void;
  onAnswerPermission?: (interactionId: string, behavior: 'allow' | 'deny', message?: string) => void;
  /** A gate decision is in flight. */
  gateBusy?: boolean;
  /** Workspace behind the transcript — resolves agent screenshots. */
  workspaceId?: string;
  /** Owning chat (worker links, scm conflict actions). */
  chatId?: string;
  /**
   * Host slots for blocks whose renderers live outside this block
   * (extension widgets, the source-control result card). Absent → not drawn.
   */
  renderWidget?: (block: WidgetBlock) => ReactNode;
  renderScmResult?: (block: ScmResultBlock) => ReactNode;
  /** G-06 view mode (client-only). */
  viewMode?: TranscriptViewMode;
}

const TranscriptContext = createContext<TranscriptActions>({});

export const TranscriptProvider = TranscriptContext.Provider;

export function useTranscriptActions(): TranscriptActions {
  return useContext(TranscriptContext);
}

/** URL of a browser artifact (`browser/…` under the workspace root) — a screenshot the agent took. */
export function browserArtifactUrl(workspaceId: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/files/${clean.split('/').map(encodeURIComponent).join('/')}`;
}
