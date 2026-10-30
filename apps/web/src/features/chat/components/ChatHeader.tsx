// ────────────────────────────────────────────────────────────────
// F-chat-01 ChatHeader — the chat workspace's 44px C-01 PageHeader (boards
// Main, ChatLight, ChatNarrow; D-21). Replaces the chat branch of the legacy
// global Header (P4-12).
//
//   breadcrumb  project (or Chats) / chat name — the name is the page's h1
//   status      D-18 badge from the live stream: Running / Needs you (a gate
//               is pending) / Done / Failed; a neutral "Archived" chip for an
//               archived chat; nothing while idle (no fake state, D-36)
//   meta        fork provenance ("Forked from …", back to the parent) and the
//               primary mount's branch chip (dropped below 1200px)
//   actions     Open (split: the default editor's mark; the menu offers VS
//               Code and Cursor), then More ▸ Copy path, Show in Finder on
//               desktop, Rename…, Copy transcript, Fork, Archive… (confirm;
//               active chats only)
//   dockToggle  "Show side pane" / "Hide side pane" (`dock-toggle`), pressed
//               while the dock is open (09 §7.3)
// ────────────────────────────────────────────────────────────────

import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { chatActivity, resolveMapping, type Chat, type StreamStatus } from '@generatorai/shared';
import { displayChatTitle } from '@generatorai/shared/ui-contract';
import { describeMount } from '@generatorai/client-core';
import { useArchiveChat, useChat, useRenameChat } from '@/hooks/queries.js';
import { useProject } from '@/hooks/projectQueries.js';
import { useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { RAIL_QUERY, useMediaQuery } from '@/hooks/useMediaQuery.js';
import { shortcutFor } from '@/lib/shortcuts.js';
import { useEditorActions, FILE_MANAGER } from '@/blocks/editor/useEditorActions.js';
import { OpenInEditorButton } from '@/blocks/editor/OpenInEditorButton.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { Breadcrumb, type BreadcrumbItem } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { MenuButton, type MenuButtonItem } from '@/ui/patterns/MenuButton/MenuButton.js';
import { StatusBadge } from '@/ui/primitives/StatusBadge/StatusBadge.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Dialog, DialogBody, DialogClose, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { useConfirm } from '@/ui/primitives/AlertDialog/AlertDialog.js';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import { useChatActions } from '../hooks/useChatActions.js';

export interface ChatHeaderProps {
  chat: Chat;
  /** The live stream's status (undefined before the chat's first turn). */
  streamStatus: StreamStatus | undefined;
  /** A plan / question / permission gate is waiting on the user. */
  awaitingUser: boolean;
  dockOpen: boolean;
  onToggleDock: () => void;
}

/** "Forked from <parent>" — where a branched conversation came from. */
function ForkProvenance({ parentChatId }: { parentChatId: string }) {
  const navigate = useNavigate();
  // The parent's name is fetched lazily (only on a fork) and falls back to a
  // neutral label rather than an id: a chat the user can no longer read is
  // still worth saying came from somewhere.
  const { data: parent } = useChat(parentChatId);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon="branch"
      data-testid="fork-provenance"
      onClick={() => navigate(`/chats/${parentChatId}`)}
      title="Open the chat this one branched from. The fork has its own copy of the files, on its own branch."
      className="max-w-60 min-w-0 text-fg-3"
    >
      <span className="truncate">{parent?.name ? `Forked from ${parent.name}` : 'Forked chat'}</span>
    </Button>
  );
}

function RenameDialog({ chat, open, onOpenChange }: { chat: Chat; open: boolean; onOpenChange: (open: boolean) => void }) {
  const rename = useRenameChat(chat.id);
  const [name, setName] = useState(chat.name);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || trimmed === chat.name) {
      onOpenChange(false);
      return;
    }
    setError(null);
    rename.mutate(trimmed, {
      onSuccess: () => onOpenChange(false),
      onError: (err: unknown) => setError(err instanceof Error ? err.message : 'The server refused the new name.'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Rename chat">
      <form onSubmit={submit} className="contents">
        <DialogBody>
          <Field label="Name" error={error ?? undefined}>
            <Input value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} data-testid="chat-rename-input" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button type="submit" variant="primary" loading={rename.isPending} disabled={!trimmed} data-testid="chat-rename-save">
            Rename
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** The chat workspace's page header. */
export function ChatHeader({ chat, streamStatus, awaitingUser, dockOpen, onToggleDock }: ChatHeaderProps) {
  const narrow = useMediaQuery(RAIL_QUERY);
  const { data: project } = useProject(chat.projectId ?? undefined);
  const { data: workspaceInfo } = useWorkspaceInfo(chat.workspaceId);
  const editor = useEditorActions();
  const { copyTranscript, fork } = useChatActions(chat.id);
  const archive = useArchiveChat();
  const confirmer = useConfirm();
  const [renaming, setRenaming] = useState(false);

  const archived = chat.status === 'archived';
  const activity =
    !archived && streamStatus ? chatActivity({ stream: streamStatus, pendingInteraction: awaitingUser }) : null;
  const status = activity ? resolveMapping(activity, 'stream') : null;

  const primaryMount = [...(workspaceInfo?.mounts ?? [])]
    .filter((m) => m.status !== 'removed')
    .sort((a, b) => a.position - b.position)[0];
  // The empty workspace's `git init` branch is not a repository the user linked (D-135).
  const branch = primaryMount ? describeMount(primaryMount).branch : undefined;

  // A worker chat (orchestrator task) is reached from its orchestrator's Tasks
  // dock and leads back there; its name drops the server's "⚙ " marker.
  const { data: orchestrator } = useChat(chat.parentChatId ?? undefined);
  const title = displayChatTitle(chat.name);
  const crumbs: BreadcrumbItem[] = [
    project
      ? { label: project.name, render: <RouterLink to={`/projects/${project.id}`} /> }
      : { label: 'Chats', render: <RouterLink to="/chats" /> },
    ...(chat.parentChatId
      ? [
          {
            label: displayChatTitle(orchestrator?.name),
            render: <RouterLink to={`/chats/${chat.parentChatId}?dock=tasks`} data-testid="worker-orchestrator-link" />,
          },
        ]
      : []),
    {
      label: (
        <h1 className="inline truncate text-ui font-semibold" title={title}>
          {title}
        </h1>
      ),
    },
  ];

  const archiveChat = async () => {
    const ok = await confirmer.confirm({
      title: 'Archive chat?',
      description: "You can still read it, but you won't be able to send new messages.",
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    archive.mutate(chat.id, {
      onError: (err: unknown) =>
        toast.error('Could not archive the chat', { description: err instanceof Error ? err.message : undefined }),
    });
  };

  const items: MenuButtonItem[] = [];
  if (editor.target) {
    items.push({ id: 'copy-path', label: 'Copy path', icon: 'copy', onSelect: () => void editor.copyPath() });
    const reveal = editor.reveal;
    if (reveal) items.push({ id: 'reveal', label: `Show in ${FILE_MANAGER}`, icon: 'folder-open', onSelect: () => void reveal() });
    items.push({ type: 'separator', id: 'sep-editor' });
  }
  items.push(
    { id: 'rename', label: 'Rename…', icon: 'edit', onSelect: () => setRenaming(true) },
    { id: 'copy-transcript', label: 'Copy transcript', icon: 'copy', onSelect: () => void copyTranscript() },
    { id: 'fork', label: 'Fork', icon: 'branch', disabled: archived, onSelect: () => fork() },
  );
  if (chat.status === 'active') {
    items.push(
      { type: 'separator', id: 'sep-archive' },
      { id: 'archive', label: 'Archive…', icon: 'archive', danger: true, disabled: archive.isPending, onSelect: () => void archiveChat() },
    );
  }

  return (
    <>
      <PageHeader
        data-testid="page-header"
        breadcrumb={<Breadcrumb items={crumbs} data-testid="page-header-breadcrumb" />}
        status={
          archived ? (
            <Badge tone="neutral">Archived</Badge>
          ) : status ? (
            <StatusBadge state={status.state} label={status.label} context="chat" still data-testid="chat-status-badge" />
          ) : null
        }
        meta={
          <>
            {chat.forkedFromChatId ? <ForkProvenance parentChatId={chat.forkedFromChatId} /> : null}
            {branch && !narrow ? (
              <Chip mono size="sm" icon="branch" className="max-w-60" title={branch}>
                <span className="truncate">{branch}</span>
              </Chip>
            ) : null}
          </>
        }
        actions={
          <>
            <OpenInEditorButton />
            <MenuButton label="More" icon="more" iconOnly items={items} align="end" data-testid="chat-header-more" />
          </>
        }
        dockToggle={
          <IconButton
            icon="dock"
            label={dockOpen ? 'Hide side pane' : 'Show side pane'}
            pressed={dockOpen}
            onClick={onToggleDock}
            shortcut={shortcutFor('dock.toggle')}
            data-testid="dock-toggle"
          />
        }
      />
      {renaming ? <RenameDialog chat={chat} open={renaming} onOpenChange={setRenaming} /> : null}
      {confirmer.dialog}
    </>
  );
}
