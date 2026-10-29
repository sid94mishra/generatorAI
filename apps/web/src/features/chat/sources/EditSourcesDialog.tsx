// ────────────────────────────────────────────────────────────────
// EditSourcesDialog — change what a live chat works on (P7-01: on the kit
// Dialog; was components/chat/sources). Mounted by app/shell/EditSourcesHost.
//
// Layout (D-167, the Enhancements "Edit sources" board): a one-line intro,
// the full B-04 SourcePicker (one list scoped to the project, each source a
// sentence whose parts are its controls), then "After each turn" as one
// four-step choice. The footer says what saving rebuilds; Save is enabled
// only when something changed, and ⌘/Ctrl ↵ saves.
// ────────────────────────────────────────────────────────────────
//
// The same B-04 SourcePicker the create flows use, pre-filled from
// `chat.sources` (falling back to the workspace's realised mounts for chats
// created before that field existed) and submitted to
// `PUT /api/chats/:id/sources`.
//
// The server refuses with 409 CHAT_BUSY while a turn is running and with 400
// for a source that does not validate; both come back as a readable message
// and are shown inline rather than as a toast, because the thing to fix is
// in this form.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chat, ChatSourceControlOptions } from '@generatorai/shared';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { useUpdateChatSources, useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { useUpdateChatSourceControl } from '@/hooks/queries.js';
import {
  SourcePicker,
  chatFolderFiles,
  draftSetupKey,
  draftsFromSpecs,
  draftsToSources,
  effectiveBranch,
  validateDrafts,
  type DraftSource,
} from '@/blocks/sources/index.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { modChord } from '@/lib/shortcuts.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { DEFAULT_SOURCE_CONTROL_OPTIONS, SourceControlOptionsFields } from './SourceControlOptionsFields.js';

/** Order, setups, working directory and after-turn choice, as one comparable string. */
function snapshotOf(list: DraftSource[], primary: string | undefined, sc: ChatSourceControlOptions): string {
  return JSON.stringify([list.map((d) => `${d.key}\u0001${draftSetupKey(d)}`), primary ?? list[0]?.alias, sc]);
}

export interface EditSourcesDialogProps {
  open: boolean;
  onClose: () => void;
  chat: Chat;
}

export function EditSourcesDialog({ open, onClose, chat }: EditSourcesDialogProps) {
  const [projectId, setProjectId] = useState(chat.projectId ?? '');
  const [drafts, setDrafts] = useState<DraftSource[]>([]);
  const [primary, setPrimary] = useState<string | undefined>(chat.primarySource);
  const [error, setError] = useState<string | null>(null);

  const { data: codebases } = useProjectCodebases(projectId || undefined);
  const { data: workspace } = useWorkspaceInfo(chat.workspaceId, open);
  const update = useUpdateChatSources(chat.id);
  const updateSourceControl = useUpdateChatSourceControl(chat.id);

  /**
   * Agent-native source control lives here rather than in a separate dialog:
   * it is a property of what the chat works ON, and the mounts above are the
   * repos it would be committing to.
   */
  const [sourceControl, setSourceControl] = useState<ChatSourceControlOptions>(DEFAULT_SOURCE_CONTROL_OPTIONS);
  // What the dialog opened with: tells an edit from a no-op and counts the
  // worktrees saving would rebuild (MountService.replace, D-166).
  const [opened, setOpened] = useState<{ snapshot: string; setups: Map<string, string> } | null>(null);

  // Re-seed each time the dialog opens so an abandoned edit is not resumed,
  // and again when the mounts arrive (they carry the real branch + dirty
  // state the specs alone cannot know).
  const mounts = workspace?.mounts;
  useEffect(() => {
    if (!open) return;
    setProjectId(chat.projectId ?? '');
    setPrimary(chat.primarySource);
    setError(null);
    const sc = chat.sourceControl ?? DEFAULT_SOURCE_CONTROL_OPTIONS;
    const seeded = draftsFromSpecs(chat.sources, {
      ...(codebases ? { codebases } : {}),
      ...(mounts ? { mounts } : {}),
    });
    setSourceControl(sc);
    setDrafts(seeded);
    setOpened({ snapshot: snapshotOf(seeded, chat.primarySource, sc), setups: new Map(seeded.map((d) => [d.key, draftSetupKey(d)])) });
    // `codebases` is intentionally not a dependency: re-seeding on every
    // catalogue refetch would throw away edits in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chat.id, mounts]);

  const busy = update.isPending || updateSourceControl.isPending;

  // What the dialog opened with, to tell an edit from a no-op and to count
  // the worktrees saving would rebuild (MountService.replace, D-166).
  const changed = opened !== null && snapshotOf(drafts, primary, sourceControl) !== opened.snapshot;
  const rebuilds = drafts.filter((d) => {
    const before = d.mode === 'worktree' ? opened?.setups.get(d.key) : undefined;
    return before !== undefined && before !== draftSetupKey(d);
  }).length;

  // The one git source's branch names the after-turn sentence; several sources each keep their own.
  const gitSources = drafts.filter((d) => d.kind !== 'chat-folder' && d.meta.isGit);
  const agentBranch = useMemo(
    () => (gitSources.length === 1 && gitSources[0] ? effectiveBranch(gitSources[0], chat.name) : null),
    [gitSources, chat.name],
  );

  // D-141: the agent's files in the chat folder are kept unless the user
  // removes the folder here — and then the dialog says what goes.
  const chatFiles = chatFolderFiles(mounts);
  const discardChatFolder = chatFiles > 0 && !drafts.some((d) => d.kind === 'chat-folder');

  const save = async () => {
    if (!changed || busy) return;
    const local = validateDrafts(drafts);
    if (local) {
      setError(local);
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({
        sources: draftsToSources(drafts, chat.name),
        ...(primary ? { primary } : {}),
        ...(discardChatFolder ? { discardChatFolder: true } : {}),
      });
      // Separate endpoint (`PATCH /api/chats/:id`), separate failure mode:
      // a rejected source plan must not silently drop the switches, and a
      // rejected switch change must not claim the sources failed.
      await updateSourceControl.mutateAsync(sourceControl.autoCommit ? sourceControl : null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the sources.');
    }
  };

  // ⌘/Ctrl ↵ saves from any field while the dialog is open (the footer advertises it).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      void saveRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <Dialog
      open={open}
      // A save in flight cannot be dismissed (Escape, the scrim, Close).
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title="Sources"
      size="lg"
    >
      <DialogBody className="gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-small text-fg-3">What this chat works on. Changes apply from your next message; sources you keep are left as they are.</p>
          <SourcePicker
            chatId={chat.id}
            chatName={chat.name}
            projectId={projectId}
            onProjectIdChange={setProjectId}
            drafts={drafts}
            onChange={setDrafts}
            primaryAlias={primary}
            onPrimaryChange={setPrimary}
            error={error}
            disabled={busy}
            live
            chatFolderFiles={chatFiles}
          />
          {discardChatFolder ? (
            <Callout tone="warn" data-testid="chat-folder-discard">
              Saving deletes the chat folder and the {chatFiles >= 1000 ? '1000+' : chatFiles} file{chatFiles === 1 ? '' : 's'} the agent
              made in it. Tick it again or press Cancel to keep them.
            </Callout>
          ) : null}
        </div>
        <section className="flex flex-col gap-2.5" aria-labelledby="after-each-turn">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 id="after-each-turn" className="text-ui font-semibold text-fg">
              After each turn
            </h3>
            <span className="text-small text-fg-3">For every included git codebase, on its own branch.</span>
          </div>
          <SourceControlOptionsFields value={sourceControl} onChange={setSourceControl} branch={agentBranch} disabled={busy} />
        </section>
      </DialogBody>
      <DialogFooter
        hint={
          rebuilds > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-warn">
              <Icon concept="refresh" size={14} />
              Rebuilds {rebuilds} {rebuilds === 1 ? 'worktree' : 'worktrees'}
            </span>
          ) : (
            'Esc to close'
          )
        }
      >
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" icon="save" onClick={() => void save()} loading={busy} disabled={!changed} shortcut={modChord('↵')}>
          Save changes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
