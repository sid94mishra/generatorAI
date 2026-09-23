// ────────────────────────────────────────────────────────────────
// entityIcons — one glyph per kind of thing, everywhere it appears.
//
// The drawer, the Home feed, search results and the catalogue lists each
// picked their own icon for the same entity (a chat was MessageSquare in one
// place and MessagesSquare in another; a workflow run was GitBranch, Workflow
// or a coloured tile). These are the desktop sidebar's icons, so a chat, a
// workflow or an automation looks the same wherever it is listed.
// ────────────────────────────────────────────────────────────────

import {
  Bot,
  FileCode2,
  FolderKanban,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react-native';

export type EntityKind = 'home' | 'chat' | 'project' | 'agent' | 'workflow' | 'script' | 'automation';

export const ENTITY_ICON: Record<EntityKind, LucideIcon> = {
  home: LayoutDashboard,
  chat: MessageSquare,
  project: FolderKanban,
  agent: Bot,
  // A run is an execution of a workflow and wears the workflow's glyph.
  workflow: GitBranch,
  script: FileCode2,
  automation: RefreshCw,
};
