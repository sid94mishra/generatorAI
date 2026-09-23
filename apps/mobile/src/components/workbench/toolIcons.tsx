import {
  FileDiff,
  FolderTree,
  Gauge,
  Globe,
  ListTree,
  MonitorSmartphone,
  ScrollText,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react-native';

import type { ToolId } from './workbenchModel';

export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  changes: FileDiff,
  files: FolderTree,
  terminal: TerminalSquare,
  browser: Globe,
  computer: MonitorSmartphone,
  tasks: ListTree,
  plan: ScrollText,
  session: Gauge,
};
