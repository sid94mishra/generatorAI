// ────────────────────────────────────────────────────────────────
// useDictation — the composer's voice-input engine
// (03-component-inventory-domain.md §6.1, F-composer-12; Phase 1 rewrite —
// VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part C).
//
// Two changes from the original design, per Part C.2:
//   1. Finalized text (segment/final) is inserted at the textarea's
//      CURRENT CARET position, not appended to a separately-tracked base
//      string. This is what lets a manual edit + resume "just work" —
//      the browser's own caret is the source of truth for where new
//      speech lands, exactly like native OS dictation.
//   2. Streaming partials are written into a live region of the composer
//      that each revision replaces (see `dictationRef`), and the region is
//      detached the moment the user touches the field.
//
// `useSpeechToText` is owned HERE (not inside VoiceRecorder) because
// pausing on manual composer interaction (Part C.3) requires the
// composer's own key/paste/click handlers to call `pauseVoiceIfListening()`.
// ────────────────────────────────────────────────────────────────

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CaretInsertionSequencer, stitchDictation, splitScratchCommand, continueCase } from '@generatorai/shared';
import { useSpeechToText } from '@/hooks/useSpeechToText.js';
import { useAudioInputDevices } from '@/hooks/useAudioInputDevices.js';
import { resolveMicDeviceId, useMicPrefsStore } from '@/stores/micPrefsStore.js';
import { toast } from '@/components/Toast.js';

export interface UseDictationOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The composer's committed text. */
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
}

// ── Live reveal ──────────────────────────────────────────────────
// The streaming decoder hands over a revised partial every ~560ms (one
// encoder chunk), typically two or three words at a time, so writing each
// partial straight into the composer made the text lurch: nothing for half
// a second, then a clump. This paces the reveal one word every REVEAL_MS
// instead, so the words arrive at a typing-like cadence and the composer
// reads as continuous rather than jittery. A retraction (the decoder
// rewrote an earlier word) keeps the common prefix and re-reveals from
// there; a backlog of more than a few words is flushed at once so the
// display never falls behind the speaker. Commits bypass it entirely.
const REVEAL_MS = 70;
const REVEAL_CATCH_UP_WORDS = 6;

export function useDictation({ textareaRef, text, setText }: UseDictationOptions) {
  // Sequences insertions so two segments arriving back-to-back (before the
  // first's requestAnimationFrame caret-restore has run) compose in speech
  // order instead of racing on a not-yet-repainted textarea — see
  // CaretInsertionSequencer's doc comment for the exact failure mode this
  // fixes. `useRef` (not state) because it's mutated outside the render
  // cycle and never needs to trigger a re-render itself.
  const caretSequencerRef = useRef(new CaretInsertionSequencer());

  /**
   * The composer's text at the moment dictation started, and whether the user
   * has actually changed the field since — the two things Cancel needs to be
   * honest.
   *
   * Cancel (✕) and Accept (✓) sat next to each other doing the SAME thing:
   * partials are written straight into the composer as they are spoken, so by
   * the time either button is pressed the words are already in the field, and
   * ✕ merely stopped the microphone. Pressing the one labelled "Cancel voice
   * input" and watching every dictated word stay put is not a subtle defect.
   *
   * The snapshot is only safe to restore while dictation is the ONLY thing
   * that has changed the field. Typing during dictation is explicitly
   * supported (it pauses the mic — Part C.3), and throwing that away to undo
   * the speech would be a worse bug than the one being fixed, so a real edit
   * downgrades Cancel to "stop, and drop the words not yet committed".
   *
   * Set from the textarea's own change event (`noteTextEdited`), not from the
   * keydown that pauses dictation: pressing Escape, an arrow key or a modifier
   * pauses but changes nothing, and must not cost the user the ability to undo.
   */
  const preDictationTextRef = useRef<string | null>(null);
  const editedDuringDictationRef = useRef(false);

  // ── Live dictation region ────────────────────────────────────
  // Streaming partials are written STRAIGHT INTO the composer rather than
  // into a preview beside it, so words appear where they will actually end
  // up, as they are spoken. `dictationRef` remembers the span the
  // current utterance occupies so each revision replaces it instead of
  // appending — a streaming decoder rewrites itself constantly ("Hel" ->
  // "Hello" -> "Hello, how"), and appending each revision would produce
  // "HelHelloHello, how".
  //
  // The span is cleared whenever the user touches the composer, so a manual
  // edit is never overwritten by a partial that lands a moment later.
  // The live region is described by the composer text WITHOUT it — what sits
  // `before` and `after` the utterance. Storing those rather than a length is
  // what makes each revision a pure recomputation instead of a patch applied
  // to whatever the previous patch happened to leave behind, and it is what
  // lets the separator between `before` and the utterance be decided per
  // revision (see `stitchDictation`): "source" + "/server" needs no space,
  // "source" + "server" does.
  const dictationRef = useRef<{ before: string; after: string } | null>(null);
  /**
   * Where the last COMMITTED utterance sits in the composer text, so a
   * spoken "scratch that" can take it back out. Cleared by any manual edit,
   * because the offsets describe text the user has not touched since.
   */
  const lastCommittedRef = useRef<{ start: number; end: number } | null>(null);
  /**
   * The live region as it was when a manual edit detached it — see
   * `onSegment`. Lets the flushed, formatted segment replace the raw partial
   * that is still on screen, so the last half-second of what was said before
   * the keystroke is not lost.
   */
  const detachedRef = useRef<{ start: number; shown: string } | null>(null);
  /**
   * The committed composer text, readable synchronously.
   *
   * Partials arrive every ~190ms, faster than React re-renders settle, so a
   * handler that read `text` from its closure would repeatedly build on a
   * stale value.
   */
  const textRef = useRef('');
  textRef.current = text;

  /**
   * Whether the text of the CURRENT utterance is already visible in the
   * composer because partials put it there.
   *
   * This is what tells a committed segment whether it is new text or a
   * refinement of text the user is already looking at. Without it, typing
   * mid-dictation produced a duplicate: the partial text was on screen, the
   * edit detached the region, and the flushed segment — the same words, just
   * formatted — was then appended at the caret:
   *
   *   "…the API integration by NOTE so I wanted to talk about the project
   *    timeline. we need to finish the API integration by Friday…"
   */
  const utteranceShownRef = useRef(false);
  /** The exact partial text last written for the current utterance. */
  const shownTextRef = useRef('');

  /**
   * Insert a finalized segment at the caret (the batch-engine path, and
   * `onFinal`). With `track`, the inserted span becomes the utterance a
   * following "scratch that" retracts.
   */
  const insertAtCaret = useCallback(
    (raw: string, track = false) => {
      const el = textareaRef.current;

      if (!el) {
        const insertText = raw.trim();
        if (insertText) setText((prev) => (prev ? `${prev.trimEnd()} ${insertText}` : insertText));
        return;
      }

      setText((prev) => {
        // A batch engine's segment starts with a capital whether or not it
        // continues the previous sentence; decide from what precedes it.
        const cased = continueCase(prev.slice(0, el.selectionStart), raw);
        const result = caretSequencerRef.current.insert(prev, el.selectionStart, el.selectionEnd, cased);
        if (result && track) {
          lastCommittedRef.current = { start: result.caret - cased.trim().length, end: result.caret };
        }
        return result ? result.text : prev;
      });

      requestAnimationFrame(() => {
        const el2 = textareaRef.current;
        const caret = caretSequencerRef.current.consumePending();
        if (el2 && caret != null) {
          el2.focus();
          el2.selectionStart = el2.selectionEnd = caret;
        }
      });
    },
    [setText, textareaRef],
  );

  const clearDictationRegion = useCallback(() => {
    dictationRef.current = null;
  }, []);

  /**
   * Compute the composer text with `incoming` written into `region`, joined
   * to its surroundings the way a dictation product would (spacing, sentence
   * case, symbols that attach). Pure: nothing here touches React state.
   */
  const composeRegion = useCallback((region: { before: string; after: string }, incoming: string) => {
    return stitchDictation(region.before, incoming, region.after);
  }, []);

  /**
   * Replace the live region with `incoming`; create it at the caret if absent.
   *
   * CRITICAL: everything is computed BEFORE `setText`, and the updater it
   * passes is a constant. React.StrictMode invokes state updaters twice in
   * development, so an updater that mutated the region ref or inserted a
   * separator inline ran both effects twice — which is exactly how the
   * composer ended up reading "…schedule a meeting. Hello, how are you today?
   * I would like to schedule a meeting.CCan you help me…".
   */
  const writeDictationRegion = useCallback(
    (raw: string, commit: boolean) => {
      // "scratch that" on its own retracts the PREVIOUS utterance. It is acted
      // on the moment it is recognised (as Dragon and Windows do) rather than
      // at commit, so the retracted words disappear while the speaker is still
      // talking, and whatever follows the command takes their place.
      const { scratch, rest } = splitScratchCommand(raw);
      const incoming = scratch ? rest : raw;

      let region = dictationRef.current;
      const last = lastCommittedRef.current;
      if (scratch && last) {
        // Re-open the region where the retracted utterance was, without it.
        // Also when a region is already open: the word-paced reveal opens it
        // on "scratch" alone, so the command is only recognised on a later
        // revision of the same utterance. The text around an open region is
        // the text the committed offsets describe (a manual edit clears them).
        const base = region ? `${region.before}${region.after}` : textRef.current;
        if (last.end <= base.length) {
          region = { before: base.slice(0, last.start).replace(/[ \t]+$/, ''), after: base.slice(last.end) };
          lastCommittedRef.current = null;
          dictationRef.current = region;
        }
      }
      if (!region) {
        const el = textareaRef.current;
        const prev = textRef.current;
        const at = el ? Math.min(el.selectionStart, prev.length) : prev.length;
        region = { before: prev.slice(0, at), after: prev.slice(at) };
        dictationRef.current = region;
      }

      const { text: next, start, end } = composeRegion(region, incoming);
      const caret = end;
      if (commit) {
        // Committed text becomes what the NEXT utterance is written into.
        dictationRef.current = null;
        lastCommittedRef.current = incoming ? { start, end } : null;
      }
      textRef.current = next;
      utteranceShownRef.current = !commit;
      shownTextRef.current = commit ? '' : incoming;
      detachedRef.current = null;
      setText(next);

      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = Math.min(caret, el.value.length);
        el.selectionStart = el.selectionEnd = pos;
      });
    },
    [composeRegion, setText, textareaRef],
  );

  const revealRef = useRef<{ target: string; shown: string; timer: ReturnType<typeof setInterval> | null }>({
    target: '', shown: '', timer: null,
  });

  const stopReveal = useCallback(() => {
    const r = revealRef.current;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    r.target = '';
    r.shown = '';
  }, []);

  const revealStep = useCallback(() => {
    const r = revealRef.current;
    if (r.shown === r.target) {
      if (r.timer) clearInterval(r.timer);
      r.timer = null;
      return;
    }
    const rest = r.target.slice(r.shown.length);
    const backlog = rest.split(/\s+/).filter(Boolean).length;
    let end = r.target.indexOf(' ', r.shown.length + 1);
    if (end === -1 || backlog > REVEAL_CATCH_UP_WORDS) end = r.target.length;
    r.shown = r.target.slice(0, end);
    writeDictationRegion(r.shown, false);
  }, [writeDictationRegion]);

  const revealPartial = useCallback((t: string) => {
    const r = revealRef.current;
    let common = 0;
    const n = Math.min(r.shown.length, t.length);
    while (common < n && r.shown[common] === t[common]) common += 1;
    if (common < r.shown.length) r.shown = t.slice(0, common);
    r.target = t;
    if (!r.timer) {
      revealStep();
      if (r.shown !== r.target) r.timer = setInterval(revealStep, REVEAL_MS);
    }
  }, [revealStep]);

  useEffect(() => () => { const r = revealRef.current; if (r.timer) clearInterval(r.timer); }, []);

  // Which microphone dictation records from. Chosen in Settings > Audio and
  // resolved against what is plugged in RIGHT NOW, so a headset that was
  // unplugged since falls back to the system default instead of failing.
  const micDeviceId = useMicPrefsStore((st) => st.deviceId);
  // Only a user who CHOSE a microphone needs the device list here (to map the
  // saved choice onto what is plugged in). Everyone else records from the
  // system default, which needs no enumeration at all.
  const micDevices = useAudioInputDevices({ enabled: micDeviceId !== '' });
  const micDeviceLabel = useMicPrefsStore((st) => st.deviceLabel);
  const resolvedMicId = useMemo(
    () => resolveMicDeviceId(micDevices.devices, { deviceId: micDeviceId, deviceLabel: micDeviceLabel }),
    [micDevices.devices, micDeviceId, micDeviceLabel],
  );

  const {
    isSupported: voiceSupported,
    status: voiceStatus,
    error: voiceError,
    amplitude: voiceAmplitude,
    start: startVoice,
    pause: pauseVoice,
    resume: resumeVoice,
    stop: stopVoice,
    cancel: cancelVoice,
  } = useSpeechToText({
    // Partials go into the composer itself. On an engine with a native
    // streaming decoder these arrive every ~190ms, sub-word; on a batch
    // engine the server sends none and only the segments below appear.
    onInterim: (t) => revealPartial(t),
    onSegment: (t) => {
      stopReveal();
      if (dictationRef.current) {
        // Normal case: refine the live region in place and commit it.
        writeDictationRegion(t, true);
      } else if (utteranceShownRef.current) {
        // The user edited the composer while this utterance was still open,
        // which detached the region. Its words are already on screen — and
        // already filler-stripped, because partials go through the
        // interim-safe formatter too — so re-inserting the whole segment
        // would duplicate them somewhere the user did not put them.
        //
        // The flushed segment usually carries a few more words than the last
        // partial (whatever was being spoken as the keystroke landed), so it
        // replaces the partial IN PLACE — but only if that partial is still
        // exactly where it was. If the user's edit moved or changed it, the
        // segment is dropped: losing the half-word you were mid-way through
        // is the cheaper, predictable failure. The caret is shifted by the
        // difference when it sits after the region, so the keystrokes the
        // user is typing right now are not displaced.
        const detached = detachedRef.current;
        const current = textRef.current;
        if (detached && current.slice(detached.start, detached.start + detached.shown.length) === detached.shown) {
          const region = { before: current.slice(0, detached.start), after: current.slice(detached.start + detached.shown.length) };
          const { text: next, end } = composeRegion(region, splitScratchCommand(t).rest);
          const el = textareaRef.current;
          const selStart = el?.selectionStart ?? next.length;
          const selEnd = el?.selectionEnd ?? next.length;
          const delta = next.length - current.length;
          textRef.current = next;
          lastCommittedRef.current = null;
          setText(next);
          requestAnimationFrame(() => {
            const el2 = textareaRef.current;
            if (!el2) return;
            const oldEnd = detached.start + detached.shown.length;
            const shift = (pos: number): number => (pos >= oldEnd ? pos + delta : Math.min(pos, end));
            el2.selectionStart = shift(selStart);
            el2.selectionEnd = shift(selEnd);
          });
        }
        detachedRef.current = null;
        utteranceShownRef.current = false;
        shownTextRef.current = '';
      } else if (lastCommittedRef.current && splitScratchCommand(t).scratch) {
        // A batch engine's "scratch that": retract the previous segment the
        // same way the streaming path does, instead of typing the command.
        writeDictationRegion(t, true);
      } else {
        // Nothing was previewed (a batch engine emits no partials at all), so
        // this segment IS the text — and the utterance "scratch that" takes back.
        insertAtCaret(t, true);
      }
    },
    onFinal: (t) => {
      stopReveal();
      preDictationTextRef.current = null;
      clearDictationRegion();
      lastCommittedRef.current = null;
      detachedRef.current = null;
      utteranceShownRef.current = false;
      shownTextRef.current = '';
      if (t) insertAtCaret(t);
    },
    onError: (message) => toast({ variant: 'error', title: 'Voice input', description: message }),
    deviceId: resolvedMicId,
  });

  const handleVoiceStart = useCallback(() => {
    stopReveal();
    clearDictationRegion();
    preDictationTextRef.current = textRef.current;
    editedDuringDictationRef.current = false;
    void startVoice();
  }, [startVoice, clearDictationRegion, stopReveal]);

  /** ✕ — stop dictating and take back what this session put in the composer. */
  const handleVoiceCancel = useCallback(() => {
    stopReveal();
    const snapshot = preDictationTextRef.current;
    const region = dictationRef.current;
    if (snapshot != null && !editedDuringDictationRef.current) {
      textRef.current = snapshot;
      setText(snapshot);
    } else if (region) {
      // Typed-during-dictation: only the open, uncommitted utterance goes.
      const restored = `${region.before}${region.after}`;
      textRef.current = restored;
      setText(restored);
    }
    clearDictationRegion();
    lastCommittedRef.current = null;
    detachedRef.current = null;
    utteranceShownRef.current = false;
    shownTextRef.current = '';
    preDictationTextRef.current = null;
    cancelVoice();
  }, [cancelVoice, clearDictationRegion, stopReveal, setText]);

  /** The textarea's value was changed by the user (not by dictation). */
  const noteTextEdited = useCallback(() => {
    if (preDictationTextRef.current !== null) editedDuringDictationRef.current = true;
  }, []);

  // Part C.3: EDITING the composer while dictation is live pauses it, so a
  // manual correction and an incoming segment can't fight over the caret.
  // Also drops any pending programmatic caret-restore (see insertAtCaret
  // above) — once the user has genuinely touched the textarea, a
  // `segment`/`final` frame that arrives moments later (network latency after
  // the `pause` frame was sent) must land at their new position, not silently
  // yank the caret back to wherever dictation had left off.
  //
  // "Editing" means typing or pasting — NOT clicking. Clicking is how you put
  // the caret somewhere, and it is the first half of almost every correction,
  // so pausing on it meant dictation stopped before the user had changed
  // anything and stayed stopped until they noticed the pill and clicked it.
  // Moving the caret still cancels the pending restore, which is the part
  // that actually matters for a click.
  const noteManualCaretMove = useCallback(() => {
    caretSequencerRef.current.clearPending();
    stopReveal();
    // The live region's offsets describe the text as it was; once the user has
    // moved or edited around it, the next partial must start a fresh span
    // rather than overwrite whatever now sits at those offsets. Remember
    // where the partial was, so the flushed segment can still refine it.
    const region = dictationRef.current;
    if (region && utteranceShownRef.current && shownTextRef.current) {
      const { start } = composeRegion(region, shownTextRef.current);
      detachedRef.current = { start, shown: shownTextRef.current };
    }
    clearDictationRegion();
    // "scratch that" must never remove text the user has since edited.
    lastCommittedRef.current = null;
  }, [clearDictationRegion, composeRegion, stopReveal]);

  const pauseVoiceIfListening = useCallback(() => {
    noteManualCaretMove();
    if (voiceStatus === 'listening') pauseVoice();
  }, [voiceStatus, pauseVoice, noteManualCaretMove]);

  return {
    voiceSupported,
    voiceStatus,
    voiceError,
    voiceAmplitude,
    resumeVoice,
    stopVoice,
    /** The microphone dictation records from (undefined = system default). */
    resolvedMicId,
    micDeviceLabel,
    handleVoiceStart,
    handleVoiceCancel,
    noteTextEdited,
    noteManualCaretMove,
    pauseVoiceIfListening,
  };
}

export type Dictation = ReturnType<typeof useDictation>;
