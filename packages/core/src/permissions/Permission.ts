// ────────────────────────────────────────────────────────────────
// Permission — TOL-02 domain permission model (harness-agnostic).
//
// Every agent harness expresses permission requests in its own vocabulary:
// Copilot emits `kind: 'shell' | 'write' | 'read' | 'mcp' | 'url'`, Claude
// emits tool-specific permission types, OpenAI doesn't emit any and expects
// the caller to gate tool execution. Rather than pick one vendor's model,
// we standardise on a small domain type and let each adapter translate.
//
// Custom tools (TOL-01) declare what they need via `requiredPermissions`;
// the `PermissionPolicy` (TOL-04) decides allow/deny/ask for each one
// before the harness runs the tool.
// ────────────────────────────────────────────────────────────────

/**
 * Permission categories the domain understands. Adapters translate their
 * vendor's kinds to these — see `packages/copilot-bridge/src/permissionMap.ts`
 * for the Copilot SDK mapping.
 *
 * The list intentionally collapses several fine-grained kinds into `other`;
 * we broaden it only when a real tool needs finer discrimination.
 */
export type PermissionKind =
  | 'shell_exec'  // Running a shell command
  | 'file_write'  // Creating, modifying, or deleting a file
  | 'file_read'   // Reading a file
  | 'network'     // HTTP fetch / URL access
  | 'mcp'         // Invoking a tool on an MCP server
  | 'other';

/**
 * A single permission a tool either needs or a rule applies to. `resource`
 * is an optional matcher — e.g. a glob for file paths or a host pattern
 * for network calls. Left open so tools can attach whatever matcher is
 * meaningful for their domain.
 */
export interface Permission {
  kind: PermissionKind;
  /** Optional resource matcher (glob / pattern / substring — rule-defined). */
  resource?: string;
  /** Human-readable description shown in prompts + logs. */
  description?: string;
}
