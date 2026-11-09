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
  /** Settings › Mobile devices: also a live toggle that adds or removes tools. */
  devicesEnabled: boolean;
  /**
   * Settings › Context compaction: the provider takes it when the conversation is built (Claude's CLI environment,
   * Codex's thread config), so a change rebinds — the setting says it applies from each chat's next message.
   */
  autoCompact?: { enabled: boolean; thresholdPct?: number } | undefined;
}

export function formatConversationBindingKey(parts: BindingKeyParts): string {
  const cu = parts.computerUseEnabled ? '1' : '0';
  const dv = parts.devicesEnabled ? '1' : '0';
  const ac = !parts.autoCompact ? 'd' : !parts.autoCompact.enabled ? '0' : String(parts.autoCompact.thresholdPct ?? 'on');
  return `${parts.harnessType}::${parts.model}::${parts.agentRef}::${parts.agentVersion}::cu${cu}::dv${dv}::pm${parts.permissionMode ?? '-'}::ac${ac}`;
}
