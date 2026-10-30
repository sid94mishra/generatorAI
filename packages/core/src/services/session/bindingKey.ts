// ────────────────────────────────────────────────────────────────
// Conversation binding key: the model + provider + agent + permission
// attachment a live conversation was built with. The owner compares it on
// the next turn and rebinds the conversation (resume with the new config)
// when it changed. ONE formatter for the site that records a binding and the
// site that compares it (review 3.6).
// ────────────────────────────────────────────────────────────────

export interface BindingKeyParts {
  harnessType: string;
  model: string;
  agentRef: string;
  agentVersion: number;
  /** The construction-time permission mode (decides whether the handler attaches). */
  permissionMode?: string | undefined;
  /**
   * Computer Use is a live Settings toggle: a conversation built before it
   * flipped must rebind, or it keeps (or lacks) desktop control.
   */
  computerUseEnabled: boolean;
}

export function formatConversationBindingKey(parts: BindingKeyParts): string {
  const cu = parts.computerUseEnabled ? '1' : '0';
  return `${parts.harnessType}::${parts.model}::${parts.agentRef}::${parts.agentVersion}::cu${cu}::pm${parts.permissionMode ?? '-'}`;
}
