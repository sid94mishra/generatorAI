// ────────────────────────────────────────────────────────────────
// CreateChatDraft → CreateChatParams — the one place `NewChatDialog` and
// `ChatCreatePage` agree on how a draft becomes the create request (P5-09).
//
// Deliberately pure and React-free so the real risk (a name that silently
// falls back wrong, a source error that does not block submit, sending
// `agentRef` for `who: 'model'`) is unit-tested rather than eyeballed in the
// browser. `blocks/sources`' `draftsToSources`/`validateDrafts` own the
// source-list half of this mapping; this module owns everything else.
// ────────────────────────────────────────────────────────────────

import type { BrowserConfig, CreateChatParams } from '@generatorai/shared';
import type { CreateChatDraft, ChatCreateBrowserSettings } from '@generatorai/shared/ui-contract';
import { chatNameFromPrompt } from '@generatorai/shared/ui-contract';
import { draftsToSources, validateDrafts, type DraftSource } from '@/blocks/sources/model.js';

/** Which surface is asking — only changes the wording of the blocking reason. */
export type ChatCreateAction = 'start' | 'create';

export interface ChatCreateFormInput {
  draft: CreateChatDraft;
  sourceDrafts: readonly DraftSource[];
}

/**
 * Why the primary button is disabled, or `null` when the draft is ready to
 * submit. Task is the one required field (D-36/R-1: the old dialog required
 * `name`; the redesign names the chat from the task instead — 03-domain
 * F-create-01/02, ChatCreateModel board). Source errors (bad alias, a mode a
 * source cannot support…) reuse `validateDrafts`'s own sentences.
 */
export function chatCreateBlockingReason(input: ChatCreateFormInput, action: ChatCreateAction): string | null {
  if (!input.draft.prompt.trim()) {
    return `Describe the task to ${action} the chat`;
  }
  return validateDrafts([...input.sourceDrafts]);
}

/** `''` (empty draft) → `undefined`; server default headless with no extras → `undefined` (D-36: never send a no-op config). */
export function browserSettingsToConfig(settings: ChatCreateBrowserSettings | undefined): BrowserConfig | undefined {
  if (!settings) return undefined;
  const hosts = (settings.allowedHostsCsv ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isDefaultShape = settings.visibility === 'headless' && !settings.evalAllowed && hosts.length === 0;
  if (isDefaultShape) return undefined;
  return {
    enabled: true,
    visibility: settings.visibility,
    ...(settings.evalAllowed ? { evalAllowed: true } : {}),
    ...(hosts.length > 0 ? { allowedHosts: hosts } : {}),
  };
}

/** The name shown while the task box is still empty, and what a blank Name field resolves to on submit. */
export function chatCreateDisplayName(draft: Pick<CreateChatDraft, 'name' | 'prompt'>): string {
  return draft.name.trim() || chatNameFromPrompt(draft.prompt);
}

/**
 * The full create request. Callers await `useCreateChat().mutateAsync(...)`
 * with this, then (task non-empty, guaranteed by `chatCreateBlockingReason`)
 * send the task as the chat's first message and navigate to it — creation
 * itself carries no message field (`CreateChatParams` has none; the task is
 * a turn, not chat metadata).
 */
function harnessConfigOf(draft: CreateChatDraft): Pick<CreateChatParams, 'harnessConfig'> {
  const harnessConfig: NonNullable<CreateChatParams['harnessConfig']> = {};
  if (draft.reasoningEffort) harnessConfig.reasoningEffort = draft.reasoningEffort as NonNullable<typeof harnessConfig.reasoningEffort>;
  if (draft.contextTier === 'default' || draft.contextTier === 'long_context') harnessConfig.contextTier = draft.contextTier;
  return Object.keys(harnessConfig).length > 0 ? { harnessConfig } : {};
}

export function buildCreateChatParams(input: ChatCreateFormInput): CreateChatParams {
  const { draft, sourceDrafts } = input;
  const name = chatCreateDisplayName(draft) || 'Untitled chat';
  const sources = draftsToSources([...sourceDrafts], name);
  const primary = draft.primaryAlias ?? sourceDrafts[0]?.alias;
  const browserConfig = browserSettingsToConfig(draft.browser);

  return {
    name,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    // The Effort / Context controls of both create flows: without these the chat ran on the model's defaults.
    ...harnessConfigOf(draft),
    ...(draft.tags.length > 0 ? { tags: [...draft.tags] } : {}),
    ...(draft.projectId ? { projectId: draft.projectId } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(sources.length > 0 && primary ? { primary } : {}),
    ...(draft.orchestratorMode ? { orchestratorMode: true } : {}),
    // The model-only path (`who: 'model'`) never binds an agent, even if a
    // prior selection is still sitting in the draft (switching "Who" back
    // to "Just a model" does not clear it — the picker's own state does).
    ...(draft.who !== 'model' && draft.agentRef ? { agentRef: draft.agentRef } : {}),
    ...(browserConfig ? { browserConfig } : {}),
  };
}
