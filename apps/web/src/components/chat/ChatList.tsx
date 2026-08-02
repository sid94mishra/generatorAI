// ────────────────────────────────────────────────────────────────
// ChatList — v2 Chat list for sidebar display
// Shows active chats sorted by updatedAt, with status indicators
// and search/filter capability
// ────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from 'react';
import { useChats } from '@/hooks/queries.js';
import { cn } from '@/lib/utils.js';
import { MessageSquare, Search, Archive, Loader2 } from 'lucide-react';
import type { Chat } from '@generatorai/shared';

interface ChatListProps {
  activeChatId?: string;
  onSelectChat: (chatId: string) => void;
}

/** Format a relative time string like "2m ago", "1h ago", "3d ago" */
function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  const months = Math.floor(days / 30);
  return `${String(months)}mo ago`;
}

export function ChatList({ activeChatId, onSelectChat }: ChatListProps) {
  const { data: chats, isLoading, error } = useChats('active');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter and sort chats
  const filteredChats = useMemo(() => {
    if (!chats) return [];
    let result = chats;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (chat) =>
          chat.name.toLowerCase().includes(query) ||
          (chat.description?.toLowerCase().includes(query) ?? false) ||
          chat.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    // Sort by updatedAt descending (most recent first)
    return [...result].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [chats, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-center text-xs text-[var(--color-destructive)]">
        Failed to load chats
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Search */}
      {(chats?.length ?? 0) > 3 && (
        <div className="relative px-2 pt-1 pb-2">
          <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-background)] py-2 pl-9 pr-3 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)] focus:outline-none"
          />
        </div>
      )}

      {/* Chat items */}
      {filteredChats.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--color-muted-foreground)]">
          {searchQuery ? 'No matching chats' : 'No chats yet'}
        </div>
      ) : (
        filteredChats.map((chat) => (
          <ChatListItem
            key={chat.id}
            chat={chat}
            isActive={chat.id === activeChatId}
            onClick={() => onSelectChat(chat.id)}
          />
        ))
      )}
    </div>
  );
}

interface ChatListItemProps {
  chat: Chat;
  isActive: boolean;
  onClick: () => void;
}

function ChatListItem({ chat, isActive, onClick }: ChatListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors',
        isActive
          ? 'bg-[var(--color-sidebar-accent)] text-[var(--color-sidebar-accent-foreground)]'
          : 'text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)]/50',
      )}
    >
      {/* Icon */}
      <div className={cn(
        'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
        isActive
          ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
          : 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
      )}>
        {chat.status === 'archived' ? (
          <Archive className="h-3.5 w-3.5" />
        ) : (
          <MessageSquare className="h-3.5 w-3.5" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            'truncate text-sm',
            isActive ? 'font-semibold' : 'font-medium',
          )}>
            {chat.name}
          </span>
          <span className="flex-shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
            {timeAgo(chat.updatedAt)}
          </span>
        </div>
        {chat.description && (
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted-foreground)]">
            {chat.description}
          </p>
        )}
        {/* Tags */}
        {chat.tags.length > 0 && (
          <div className="mt-1 flex gap-1 overflow-hidden">
            {chat.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-[var(--color-accent)]/50 px-1.5 py-0.5 text-[9px] text-[var(--color-muted-foreground)]"
              >
                {tag}
              </span>
            ))}
            {chat.tags.length > 2 && (
              <span className="text-[9px] text-[var(--color-muted-foreground)]">
                +{String(chat.tags.length - 2)}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
