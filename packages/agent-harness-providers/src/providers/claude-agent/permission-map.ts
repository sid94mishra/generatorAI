// ────────────────────────────────────────────────────────────────
// permission-map.ts — Claude built-in tool → domain permission type
// ────────────────────────────────────────────────────────────────
//
// The Claude SDK invokes `canUseTool(toolName, input, ctx)` for every
// tool call it wants to execute. We translate that into the domain's
// `PermissionRequest.type` union so the session gates (`StageGatePort`, the chat gates)
// can apply the same policy across providers (Copilot / Claude / …).
//
// Mapping rules (case-insensitive on the tool name):
//   - file-read tools (Read / Glob / Grep / LS)     → 'file_read'
//   - file-write tools (Write / Edit / MultiEdit / NotebookEdit) → 'file_write'
//   - shell tools     (Bash / BashOutput / KillShell)             → 'shell_exec'
//   - network tools   (WebFetch / WebSearch)                      → 'network'
//   - anything else (MCP tools, custom tools)                     → 'other'
//
// `other` is intentionally the safe default: `acceptEdits` HITL-gates it,
// so unfamiliar tools require a human unless the user has explicitly
// bypassed permissions.

export type DomainPermissionType =
  | 'file_write'
  | 'file_read'
  | 'shell_exec'
  | 'network'
  | 'other';

export function mapClaudeToolNameToDomainType(toolName: string): DomainPermissionType {
  const n = toolName.toLowerCase();
  if (n === 'write' || n === 'edit' || n === 'multiedit' || n === 'notebookedit') return 'file_write';
  if (n === 'read' || n === 'glob' || n === 'grep' || n === 'ls') return 'file_read';
  if (n === 'bash' || n === 'bashoutput' || n === 'killshell') return 'shell_exec';
  if (n === 'webfetch' || n === 'websearch') return 'network';
  return 'other';
}
