// The chat folder is a source with no path, branch or alias of its own (D-141).
import type { ChatSourceSpec } from '../types/Workspace.js';

/** A source the user points at: a project codebase or a folder. */
export type MountableSourceSpec = Exclude<ChatSourceSpec, { kind: 'chat-folder' }>;

/** The alias the chat folder always mounts under (its path is `<workspace>/source/main`). */
export const CHAT_FOLDER_ALIAS = 'main';

/** The mount alias a source asks for (the chat folder's is fixed). */
export function chatSourceAlias(spec: ChatSourceSpec): string | undefined {
  return spec.kind === 'chat-folder' ? CHAT_FOLDER_ALIAS : spec.alias;
}

export function isMountableSource(spec: ChatSourceSpec): spec is MountableSourceSpec {
  return spec.kind !== 'chat-folder';
}
