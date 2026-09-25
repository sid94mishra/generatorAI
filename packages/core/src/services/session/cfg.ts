// ────────────────────────────────────────────────────────────────
// Pure helpers the session composer uses to assemble a conversation config.
//
// The config is built as a plain record and asserted to
// `CreateConversationParams` at the harness boundary. These three helpers are
// the only way a block, a tool list or an exclusion list is added to it, so
// every builder appends in exactly the same way (the prompt-cache prefix
// depends on it, R-10).
// ────────────────────────────────────────────────────────────────

/** A conversation config under construction. */
export type ConversationConfig = Record<string, unknown>;

type SystemMessage = { mode?: string; content?: string };

/**
 * Append `text` to the system message, keeping its mode (`append` when there
 * is none yet). A falsy `text` is a no-op, so optional blocks need no guard.
 */
export function appendSystemBlock(cfg: ConversationConfig, text: string | undefined): void {
  if (!text) return;
  const existing = cfg['systemMessage'] as SystemMessage | undefined;
  cfg['systemMessage'] = {
    mode: (existing?.mode as 'append' | 'replace' | undefined) ?? 'append',
    content: (existing?.content ?? '') + text,
  };
}

/** The system message content as it stands (empty when unset). */
export function systemContent(cfg: ConversationConfig): string {
  return (cfg['systemMessage'] as SystemMessage | undefined)?.content ?? '';
}

/**
 * Add tools to the config's tool list. `start` puts them in front of what is
 * already there (the browser set is the model's primary path), `end` after.
 */
export function appendTools(cfg: ConversationConfig, tools: readonly unknown[], where: 'start' | 'end' = 'end'): void {
  const existing = Array.isArray(cfg['tools']) ? (cfg['tools'] as unknown[]) : [];
  cfg['tools'] = where === 'start' ? [...tools, ...existing] : [...existing, ...tools];
}

/** Union `values` into the string list at `key`, keeping first-seen order. */
export function unionList(cfg: ConversationConfig, key: string, values: readonly string[]): void {
  const existing = Array.isArray(cfg[key]) ? (cfg[key] as string[]) : [];
  cfg[key] = [...new Set([...existing, ...values])];
}
