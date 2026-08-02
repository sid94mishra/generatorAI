// ────────────────────────────────────────────────────────────────
// SourceBadge — Visual badge indicating System vs Project artifact
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Shield, FolderKanban } from 'lucide-react';

interface SourceBadgeProps {
  source: 'system' | 'project';
}

export function SourceBadge({ source }: SourceBadgeProps) {
  if (source === 'system') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <Shield className="h-2.5 w-2.5" />
        System
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
      <FolderKanban className="h-2.5 w-2.5" />
      Project
    </span>
  );
}
