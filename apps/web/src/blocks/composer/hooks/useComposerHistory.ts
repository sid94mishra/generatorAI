// ────────────────────────────────────────────────────────────────
// useComposerHistory — ↑ / ↓ recall of earlier prompts, and the prompt a
// rewind hands back (03-component-inventory-domain.md §6.1, F-composer-23/24).
//
// `historyIdx` is null while the user's own draft is showing. The draft is
// parked when they start browsing so ↓ past the newest entry brings it back
// untouched. Prompts sent this session are remembered locally (last 50) so ↑
// works before the server echoes them back.
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/ui/primitives/Toast/Toast.js';
import type { ComposerAttachment, CaptureSource } from '../model/types.js';
import {
  caretLine,
  materializeAttachment,
  mergePromptHistory,
  stepHistory,
  type PromptHistoryEntry,
} from '../model/promptHistory.js';
import type { ComposerDraft } from './useComposerDraft.js';

export interface UseComposerHistoryOptions {
  /** Prompts already sent in this chat (oldest → newest), with their attachments. */
  promptHistory: PromptHistoryEntry[] | undefined;
  /** A prompt handed back by a rewind; `at` is the delivery token. Never auto-sent. */
  restoredDraft: { text: string; at: number } | undefined;
  draft: ComposerDraft;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface ComposerHistory {
  /** ↑ / ↓ inside the textarea. Returns true when the key was consumed. */
  navigateHistory: (dir: -1 | 1, el: HTMLTextAreaElement) => boolean;
  /** Editing a recalled prompt makes it the user's own draft again. */
  leaveHistory: () => void;
  /** Remember a sent prompt so ↑ recalls it at once; ends any browsing. */
  recordSent: (text: string, attachments: ComposerAttachment[]) => void;
  /** The last recorded send went out as `prompt` (a `/command`'s formatted text), so its echo is recognised. */
  markSentAs: (prompt: string) => void;
}

export function useComposerHistory({
  promptHistory,
  restoredDraft,
  draft,
  textareaRef,
}: UseComposerHistoryOptions): ComposerHistory {
  const { text, attachments, setText, setAttachments, setMenu } = draft;
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const draftRef = useRef<{ text: string; attachments: ComposerAttachment[] } | null>(null);
  const localHistoryRef = useRef<PromptHistoryEntry[]>([]);
  const recallTokenRef = useRef(0);
  const history = useMemo(
    () => mergePromptHistory(promptHistory ?? [], localHistoryRef.current),
    // localHistoryRef is mutated on send; `text` clearing after a send is the
    // re-render that picks the new entry up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [promptHistory, text],
  );

  // ── Restored draft (after a rewind) ──
  // The prompt the rewind gave back lands in the box, selected at the end so
  // the user can edit or delete it immediately. Keyed on the offer token, not
  // the text, so a re-render never clobbers what they have typed since.
  const restoredAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!restoredDraft) return;
    if (restoredAtRef.current === restoredDraft.at) return;
    restoredAtRef.current = restoredDraft.at;
    setHistoryIdx(null);
    draftRef.current = null;
    setText(restoredDraft.text);
    const el = textareaRef.current;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = restoredDraft.text.length;
    });
  }, [restoredDraft, setText, textareaRef]);

  /**
   * Show history entry `idx` (or the parked draft when `null`). Attachments
   * that live on the server are fetched back into real `File`s; a fetch that
   * fails drops that one chip with a toast rather than blocking the recall.
   */
  const showHistoryEntry = useCallback(
    (idx: number | null) => {
      const token = ++recallTokenRef.current;
      setMenu(null);
      if (idx === null) {
        const parked = draftRef.current;
        setText(parked?.text ?? '');
        setAttachments(parked?.attachments ?? []);
        draftRef.current = null;
        setHistoryIdx(null);
        return;
      }
      const entry = history[idx];
      if (!entry) return;
      if (historyIdx === null) draftRef.current = { text, attachments };
      setHistoryIdx(idx);
      setText(entry.text);
      setAttachments([]);
      const el = textareaRef.current;
      requestAnimationFrame(() => {
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = entry.text.length;
        }
      });
      if (entry.attachments.length === 0) return;
      void Promise.all(
        entry.attachments.map(async (att) => {
          try {
            return await materializeAttachment(att);
          } catch {
            toast.error(`Could not restore attachment "${att.name}"`, {
              description: 'The prompt was recalled without it.',
            });
            return null;
          }
        }),
      ).then((files) => {
        if (recallTokenRef.current !== token) return; // user moved on
        setAttachments(
          files.flatMap((file, i) =>
            file ? [{ id: `history:${entry.id}:${i}`, file, source: 'file' as CaptureSource }] : [],
          ),
        );
      });
    },
    [history, historyIdx, text, attachments, setMenu, setText, setAttachments, textareaRef],
  );

  const navigateHistory = useCallback(
    (dir: -1 | 1, el: HTMLTextAreaElement): boolean => {
      if (el.selectionStart !== el.selectionEnd) return false;
      const { first, last } = caretLine(text, el.selectionStart);
      if (dir === -1 && !first) return false;
      if (dir === 1 && !last) return false;
      const next = stepHistory(historyIdx, history.length, dir);
      if (next === undefined) return false;
      showHistoryEntry(next);
      return true;
    },
    [text, historyIdx, history.length, showHistoryEntry],
  );

  const leaveHistory = useCallback(() => {
    if (historyIdx !== null) setHistoryIdx(null);
  }, [historyIdx]);

  const recordSent = useCallback((sentText: string, sentAttachments: ComposerAttachment[]) => {
    setHistoryIdx(null);
    draftRef.current = null;
    if (sentText || sentAttachments.length) {
      localHistoryRef.current = [
        ...localHistoryRef.current.slice(-49),
        {
          id: `local:${Date.now()}`,
          text: sentText,
          ts: Date.now(),
          attachments: sentAttachments.map((a) => ({ name: a.file.name, mimeType: a.file.type, file: a.file })),
        },
      ];
    }
  }, []);

  const markSentAs = useCallback((prompt: string) => {
    const list = localHistoryRef.current;
    const last = list[list.length - 1];
    if (!last || last.text === prompt) return;
    localHistoryRef.current = [...list.slice(0, -1), { ...last, sentAs: prompt }];
  }, []);

  return { navigateHistory, leaveHistory, recordSent, markSentAs };
}
