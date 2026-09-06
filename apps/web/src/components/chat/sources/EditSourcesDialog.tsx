// ────────────────────────────────────────────────────────────────
// EditSourcesDialog — change what a live chat works on
// ────────────────────────────────────────────────────────────────
//
// The same editor the new-chat dialog uses, pre-filled from `chat.sources`
// (falling back to the workspace's realised mounts for chats created before
// that field existed) and submitted to `PUT /api/chats/:id/sources`.
//
// The server refuses with 409 CHAT_BUSY while a turn is running and with 400
// for a source that does not validate; both come back as a readable message
// and are shown inline rather than as a toast, because the thing to fix is
// in this form.

import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import type { Chat } from '@generatorai/shared';
import { Button, Modal } from '@/components/ui/index.js';
import { useProjectCodebases } from '@/hooks/projectQueries.js';
import { useUpdateChatSources, useWorkspaceInfo } from '@/hooks/sourceQueries.js';
import { SourcePicker } from './SourcePicker.js';
import {
  draftsFromSpecs,
  draftsToSources,
  validateDrafts,
  type DraftSource,
} from './sourceModel.js';

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

  // Re-seed each time the dialog opens so an abandoned edit is not resumed,
  // and again when the mounts arrive (they carry the real branch + dirty
  // state the specs alone cannot know).
  const mounts = workspace?.mounts;
  useEffect(() => {
    if (!open) return;
    setProjectId(chat.projectId ?? '');
    setPrimary(chat.primarySource);
    setError(null);
    setDrafts(
      draftsFromSpecs(chat.sources, {
        ...(codebases ? { codebases } : {}),
        ...(mounts ? { mounts } : {}),
      }),
    );
    // `codebases` is intentionally not a dependency: re-seeding on every
    // catalogue refetch would throw away edits in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chat.id, mounts]);

  const busy = update.isPending;

  const save = async () => {
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
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the sources.');
    }
  };

  const summaryCount = useMemo(() => drafts.length, [drafts]);

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      dismissible={!busy}
      title="Edit sources"
      description="What this chat works on. Changes apply to the next turn; existing mounts keep their history."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={busy}
            leftIcon={<Save className="h-4 w-4" />}
          >
            Save {summaryCount} {summaryCount === 1 ? 'source' : 'sources'}
          </Button>
        </>
      }
    >
      <SourcePicker
        chatName={chat.name}
        projectId={projectId}
        onProjectIdChange={setProjectId}
        drafts={drafts}
        onChange={setDrafts}
        primaryAlias={primary}
        onPrimaryChange={setPrimary}
        error={error}
        disabled={busy}
      />
    </Modal>
  );
}
