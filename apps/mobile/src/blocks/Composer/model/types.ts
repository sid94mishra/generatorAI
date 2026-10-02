// ────────────────────────────────────────────────────────────────
// Composer v2 — shared types.
//
// Everything here is framework-free so the pure modules (attachment policy,
// slash source, history ring) and their tests can import it without pulling
// React Native into the node test runner.
// ────────────────────────────────────────────────────────────────

import type { AgentMode } from '@generatorai/client-core';

/** How an attachment entered the composer. Drives the chip's icon. */
export type ComposerAttachmentKind = 'image' | 'file' | 'capture';

/**
 * One attachment chip. `uri` is a local `file://` (or `data:` for a pasted
 * clipboard image) that is read to bytes only at send time, so a dozen
 * photos in the tray cost nothing until the user commits.
 */
export interface ComposerAttachment {
  id: string;
  kind: ComposerAttachmentKind;
  name: string;
  uri: string;
  mimeType: string;
  /** Bytes, when known up front. `0` when the platform could not tell us. */
  size: number;
  /** Thumbnail source for image chips. Same as `uri` for a picked photo. */
  previewUri?: string;
  /** Set while the send that carries it is in flight. */
  uploading?: boolean;
  /** Why the last send that carried it failed, if it did. */
  error?: string;
  /**
   * Inline text content (an `@file` mention resolved to its contents). Sent
   * as a `text/plain` part the way the web composer does it, without a
   * temporary file on disk.
   */
  text?: string;
}

/** Which picker the `+` menu should open. */
export type AttachmentSource = 'photo' | 'camera' | 'file' | 'clipboard';

/** Item kinds surfaced in the `/` and `@` suggestion strip. */
export type SlashItemKind =
  | 'command'
  | 'skill'
  | 'prompt'
  | 'navigate'
  | 'agent'
  | 'file';

/**
 * One suggestion. Slash commands, skills and prompts carry a `format` that
 * builds the outgoing prompt from the user's free text (mirrors web's
 * `SlashCommand.format`); navigation commands open a pane instead; agents
 * and files are `@` mentions.
 */
export interface SlashItem {
  id: string;
  /** Trigger token without the `/` or `@`. */
  name: string;
  /** What is rendered on the chip — `/browser`, `@src/app.ts`. */
  label: string;
  description?: string;
  kind: SlashItemKind;
  source: 'builtin' | 'system' | 'project' | 'workspace';
  /** Placeholder shown once the command is active. */
  argHint?: string;
  /** Builds the prompt the agent receives from the typed input. */
  format?: (input: string, template?: string) => string;
  /** Lazily fetches a prompt template's body — only on send. */
  loadTemplate?: () => Promise<string>;
  /** For `navigate`: which pane to open. */
  pane?: 'browser' | 'terminal' | 'changes' | 'files' | 'plan' | 'tasks';
  /** For `file`: the repo-relative path (+ mount alias). */
  path?: string;
  alias?: string;
  /** For `agent`: the portable `scope:slug` ref. */
  agentRef?: string;
}

/** A prompt the user sent before — from the server's messages or the local ring. */
export interface PromptHistoryEntry {
  id: string;
  text: string;
  /** Epoch ms — orders the merge. */
  ts: number;
  attachments?: Array<{ name: string; mimeType: string }>;
}

/** W30-b — what the Stop control should say and whether it accepts a press. */
export interface StopState {
  label: string;
  enabled: boolean;
  forceAvailable: boolean;
}

export type VoiceUiState = 'idle' | 'listening' | 'paused' | 'transcribing' | 'error';

/** The payload the controller hands the screen on send. */
export interface ComposerSendPayload {
  text: string;
  attachments: ComposerAttachment[];
  mode?: AgentMode;
}

/** Mount readiness the server attaches to a chat DTO (`workspacePrep`). */
export interface WorkspacePrepState {
  status: 'pending' | 'preparing' | 'ready' | 'error';
  error?: string;
}
